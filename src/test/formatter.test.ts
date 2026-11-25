import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { defaults, FormatterSettings } from '../configuration/settings';
import { formatSql, formatSqlResult, formatSqlSelection } from '../formatter/formatter';
import { parse } from '../formatter/parser';
import { tokenize } from '../formatter/tokenizer';

function fixture(name: string, variant: 'input' | 'expected'): string {
    return readFileSync(join(__dirname, '../../src/test/fixtures', `${name}.${variant}.sql`), 'utf8');
}

for (const name of ['reference', 'header', 'queries', 'statements', 'routines', 'opaque']) {
    test(`${name} matches its SQL snapshot and is idempotent`, () => {
        const result = formatSqlResult(fixture(name, 'input'));
        assert.equal(result.error, undefined);
        assert.equal(result.sql, fixture(name, 'expected'));
        assert.deepEqual(formatSqlResult(result.sql), result);
    });
}

test('preserves every token in each fixture when AS insertion is disabled', () => {
    const signature = (sql: string): string[][] => tokenize(sql).map(token => [
        token.kind,
        token.kind === 'word' ? token.text.toLowerCase()
            : token.kind === 'directive' ? token.text.slice(0, 9).toLowerCase() + token.text.slice(9) : token.text,
    ]);
    for (const name of ['reference', 'queries', 'statements', 'routines', 'opaque']) {
        const input = fixture(name, 'input');
        const result = formatSqlResult(input, { explicitColumnAliases: false });
        assert.equal(result.error, undefined);
        assert.deepEqual(signature(result.sql), signature(input), name);
    }
});

test('adds AS only in proven alias positions', () => {
    const input = "select a b, t.x 'Friendly', foo(CaseId) Z, 'a' 'b', x '0a', _binary 'test', date '2001-01-01', r collate utf8mb4_bin from Mixed t";
    const result = formatSql(input);
    assert.match(result, /a AS b,\n    t\.x AS 'Friendly',\n    foo\(CaseId\) AS Z,/);
    assert.match(result, /'a' 'b',\n    x '0a',\n    _binary 'test',\n    date '2001-01-01',\n    r COLLATE utf8mb4_bin/);
    assert.match(result, /FROM\n    Mixed t$/);
});

test('preserves case-sensitive table and routine names that resemble built-ins', () => {
    const input = 'insert into sum(id) values (1); create table if not exists floor(a int); create index ix on abs(a); create procedure concat() select 1;';
    assert.equal(formatSql(input), [
        'INSERT INTO sum(id)', 'VALUES', '    (1);', '',
        'CREATE TABLE IF NOT EXISTS floor(', '    a INT', ');', '',
        'CREATE INDEX ix ON abs(a);', '',
        'CREATE PROCEDURE concat()', 'SELECT', '    1;',
    ].join('\n'));
});

test('style settings compose and keep BETWEEN intact', () => {
    const input = 'select a,b from Items where a between 1 and 2 and b != ? or c = :id';
    const options: Partial<FormatterSettings> = {
        useTabs: true, keywordCase: 'lower', commaPosition: 'leading', breakBeforeLogicalOperator: false, trailingSemicolon: 'always',
    };
    const output = 'select\n\ta\n\t, b\nfrom\n\tItems\nwhere\n\ta between 1 and 2 and\n\tb != ? or\n\tc = :id;';
    assert.equal(formatSql(input, options), output);
    assert.equal(formatSql(output, options), output);
});

test('compact layout and case preferences', () => {
    const options: Partial<FormatterSettings> = {
        identifierCase: 'lower', functionCase: 'lower', clauseContentOnNewLine: false, oneColumnPerLine: false,
        joinTableOnNewLine: false, explicitColumnAliases: false,
    };
    assert.equal(formatSql('select SUM(a) Total,b X from T left join Z on Z.a=T.a', options),
        'SELECT sum(a) total, b x\nFROM t\nLEFT JOIN z ON z.a = t.a');
    assert.equal(formatSql('SeLeCt nOw() TiMeR', { keywordCase: 'preserve', functionCase: 'preserve' }),
        'SeLeCt\n    nOw() AS TiMeR');
});

test('soft line width breaks lists, window clauses and long JOIN predicates', () => {
    const options = { maxLineLength: 35, indentSize: 2, oneColumnPerLine: false };
    const input = 'select concat(first_name,last_name,description) label, sum(id) over(order by document_sequence_number) from documents d join other o on d.foreign_key_id=o.document_unique_id;';
    const result = formatSqlResult(input, options);
    assert.equal(result.error, undefined);
    assert.match(result.sql, /CONCAT\(\n    first_name,\n    last_name,\n    description\n  \)/);
    assert.match(result.sql, /OVER \(\n    ORDER BY document_sequence_number\n  \)/);
    assert.match(result.sql, /JOIN\n  other o\n    ON d\.foreign_key_id = o\.document_unique_id/);
    assert.equal(formatSql(result.sql, options), result.sql);
});

test('MariaDB RETURNING receives a clause and preserves parameters', () => {
    const input = 'insert into t (a) values (?) returning a,id;';
    assert.equal(formatSql(input, { dialect: 'mariadb' }), 'INSERT INTO t (a)\nVALUES\n    (?)\nRETURNING\n    a,\n    id;');
    assert.doesNotMatch(formatSql(input), /^RETURNING$/m);
});

test('removes ordinary comments only when requested', () => {
    const result = formatSqlResult(fixture('opaque', 'input'), { preserveComments: false });
    assert.equal(result.error, undefined);
    assert.doesNotMatch(result.sql, /Header|table note|Statement note|Tail/);
    assert.match(result.sql, /\/\*\+ MAX_EXECUTION_TIME\(1000\) \*\//);
    assert.match(result.sql, /\/\*!80000 SET @n=1 \*\//);
    assert.match(result.sql, /\/\*M!100100 SET @other=2 \*\//);
});

test('final semicolon policy preserves other terminators, comments and CRLF', () => {
    assert.equal(formatSql('select a; -- first\r\nselect b; -- last\r\n', { trailingSemicolon: 'never' }),
        'SELECT\r\n    a; -- first\r\n\r\nSELECT\r\n    b -- last\r\n');
    assert.equal(formatSql('select 1 -- tail\r\n', { trailingSemicolon: 'always' }), 'SELECT\r\n    1; -- tail\r\n');
    assert.equal(formatSql('DELIMITER //\nSELECT 1//', { trailingSemicolon: 'always' }), 'DELIMITER //\nSELECT\n    1//');
    assert.equal(formatSql('select 1;\n-- tail', { trailingSemicolon: 'never' }), 'SELECT\n    1\n-- tail');
});

test('retains BOM, quoted contents, numeric literals and parameter bytes', () => {
    const sql = '\uFEFFselect .5,1.e-5,0xA4,0b101, @@global.time_zone, @\'My Variable\', `Ab``Cd`, \'a\r\nb\'\r\n';
    const result = formatSqlResult(sql);
    assert.equal(result.error, undefined);
    assert.ok(result.sql.startsWith('\uFEFFSELECT\r\n'));
    for (const raw of ['.5', '1.e-5', '0xA4', '0b101', '@@global.time_zone', "@'My Variable'", '`Ab``Cd`', "'a\r\nb'"]) {
        assert.ok(result.sql.includes(raw), raw);
    }
});

test('handles 100 levels of grouping without changing parentheses', () => {
    const input = `select ${'('.repeat(100)}abc${')'.repeat(100)} value_alias from t`;
    const result = formatSqlResult(input);
    assert.equal(result.error, undefined);
    assert.equal((result.sql.match(/\(/g) ?? []).length, 100);
    assert.equal(formatSql(result.sql), result.sql);
});

test('returns the exact input on invalid or unsafe structure', () => {
    const inputs = [
        'select from t', 'select a, from t', 'select a from where b', 'select a + from t',
        'select 1; select (x', "select 'unterminated", 'select /* oops', 'SELECT x WHERE a =',
        'made_up_sql 1', 'delimiter $$\nselect 1;', 'create procedure p() begin select 1;',
        "set sql_mode='NO_BACKSLASH_ESCAPES'; select 'a';",
        `select ${'('.repeat(257)}x${')'.repeat(257)}`,
    ];
    for (const input of inputs) {
        const result = formatSqlResult(input);
        assert.equal(result.sql, input);
        assert.ok(result.error, input);
    }
});

test('manifest configuration defaults match the standalone engine', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    for (const [key, value] of Object.entries(defaults)) {
        assert.equal(manifest.contributes.configuration.properties[`sqlBeautifier.${key}`].default, value);
    }
});

test('executable comments stay in their statement and cannot create false aliases', () => {
    assert.equal(formatSql('select x /*! + */ y'), 'SELECT\n    x /*! + */ y');
    assert.equal(formatSql('select 1 /*! + 1 */ -- note', { trailingSemicolon: 'always' }),
        'SELECT\n    1 /*! + 1 */; -- note');
    assert.equal(formatSql('select 1;\n/*! SELECT 2 */', { trailingSemicolon: 'never' }),
        'SELECT\n    1;\n\n/*! SELECT 2 */');
});

test('formats named window definitions while preserving window identifiers', () => {
    const input = 'select sum(id) over MyWindow total from t window MyWindow as (partition by team order by id);';
    const output = 'SELECT\n    SUM(id) OVER MyWindow AS total\nFROM\n    t\nWINDOW\n    MyWindow AS (\n        PARTITION BY team\n        ORDER BY id\n    );';
    assert.equal(formatSql(input), output);
    assert.equal(formatSql(output), output);
});

test('preserves names that MySQL derives from unnamed expressions', () => {
    const input = 'select d.`a+b` from (select a+b from t) d; with c as (select a+b from t) select `a+b` from c; create view v as select a+b from t;';
    const result = formatSqlResult(input);
    assert.equal(result.error, undefined);
    assert.match(result.sql, /FROM\n    \(\n        SELECT\n            a\+b\n        FROM/);
    assert.ok(result.sql.includes('WITH c AS (\n    SELECT\n        a+b\n'));
    assert.ok(result.sql.includes('CREATE VIEW v AS\nSELECT\n    a+b\n'));
    assert.equal(formatSql(result.sql), result.sql);
});

test('retains nonreserved keywords used as identifiers', () => {
    const input = 'select t.connection,(engine),returns from connection t where engine=1 and not begin;';
    assert.equal(formatSql(input), 'SELECT\n    t.connection,\n    (engine),\n    returns\nFROM\n    connection t\nWHERE\n    engine = 1\n    AND NOT begin;');
});

test('uses one blank line between top-level statements and anchors their comments', () => {
    const input = 'select 1;select 2; -- previous\r\n\r\n\r\n-- next\r\nselect 3;\r\n-- end\r\n';
    const expected = 'SELECT\r\n    1;\r\n\r\nSELECT\r\n    2; -- previous\r\n\r\n-- next\r\nSELECT\r\n    3;\r\n-- end\r\n';
    assert.equal(formatSql(input, { preserveBlankLines: false }), expected);
    assert.equal(formatSql(input), expected.replace('-- previous\r\n', '-- previous\r\n\r\n'));
    assert.equal(formatSql(expected), expected);
    assert.equal(formatSql('select 1 union all select 2;'), 'SELECT\n    1\nUNION ALL\nSELECT\n    2;');
});

test('retains blank lines at document edges and between tokens by default', () => {
    const input = '\r\n \r\nselect 1,\r\n\r\n2;\r\n\r\n\r\n';
    const expected = '\r\n\r\nSELECT\r\n    1,\r\n\r\n    2;\r\n\r\n\r\n';
    assert.deepEqual(formatSqlResult(input), { sql: expected });
    assert.equal(formatSql(expected), expected);
    assert.equal(formatSql(input, { preserveBlankLines: false }), 'SELECT\r\n    1,\r\n    2;\r\n');
    const removed = 'select a\n\n-- note\n\nfrom t;';
    assert.equal(formatSql(removed, { preserveComments: false }), 'SELECT\n    a\n\n\nFROM\n    t;');
});

test('keeps literal and block comment contents when removing blank lines', () => {
    const input = "select 'a\n\nb' as x, /* a\n\nb */\n\n2;";
    const output = formatSql(input, { preserveBlankLines: false });
    assert.match(output, /'a\n\nb'/);
    assert.match(output, /\/\* a\n\nb \*\//);
    assert.doesNotMatch(output, /\*\/\n\n/);
});

test('file ignore applies before tokenizing invalid SQL, including selections', () => {
    const input = '\uFEFF\r\n \t-- sql-beautifier-ignore-file  \r\nselect \'unterminated';
    const settings = { preserveComments: false, preserveBlankLines: false };
    assert.deepEqual(formatSqlResult(input, settings), { sql: input });
    assert.deepEqual(selectText(input, "select 'unterminated", settings), { sql: "select 'unterminated" });
    const late = 'select 1;\n-- sql-beautifier-ignore-file\nselect 2;';
    assert.equal(formatSql(late), 'SELECT\n    1;\n\n-- sql-beautifier-ignore-file\nSELECT\n    2;');
});

test('statement ignore preserves source bytes and formats neighboring statements', () => {
    const ignored = '  \t-- sql-beautifier-ignore  \r\n  select     1\n\n ;';
    const input = 'select 0;\r\n' + ignored + '\r\nselect 2;';
    const options = { preserveComments: false, preserveBlankLines: false };
    const expected = 'SELECT\r\n    0;\r\n\r\n' + ignored + '\r\n\r\nSELECT\r\n    2;';
    assert.deepEqual(formatSqlResult(input, options), { sql: expected });
    assert.equal(formatSql(expected, options), expected);
    const eof = '-- sql-beautifier-ignore\n select 1    \n\n  ';
    assert.equal(formatSql(eof, { ...options, trailingSemicolon: 'always' }), eof);
    const unsupported = '-- sql-beautifier-ignore\nunsupported   statement;';
    assert.equal(formatSql(unsupported + '\nselect 2;'), unsupported + '\n\nSELECT\n    2;');
});

test('only standalone statements are opted out', () => {
    assert.equal(formatSql("select '\n-- sql-beautifier-ignore\n' as x;"), "SELECT\n    '\n-- sql-beautifier-ignore\n' AS x;");
    assert.equal(formatSql('select 1; -- sql-beautifier-ignore\nselect 2;'),
        'SELECT\n    1; -- sql-beautifier-ignore\n\nSELECT\n    2;');
    const routine = 'DELIMITER $$\n-- sql-beautifier-ignore\ncreate procedure p() begin select 1; end$$\nDELIMITER ;\nselect 2;';
    assert.deepEqual(formatSqlResult(routine), {
        sql: 'DELIMITER $$\n-- sql-beautifier-ignore\ncreate procedure p() begin select 1; end$$\nDELIMITER ;\nSELECT\n    2;',
    });
});

test('normalizes header dividers and keeps minus operators inside queries', () => {
    assert.equal(formatSql('-- Title\r\n  --------  \r\nselect 7----2;'),
        '-- Title\r\n-- ------  \r\nSELECT\r\n    7 - ---2;');
    assert.equal(formatSql('-- Title\n--------\nselect 7----2;', { preserveComments: false }), 'SELECT\n    7 - ---2;');
    const expression = 'select 7 -\n----2;';
    const signature = (sql: string) => tokenize(sql).map(token => [token.kind, token.text.toUpperCase()]);
    assert.deepEqual(signature(formatSql(expression)), signature(expression));
    const standalone = 'select 7\n----\n2;';
    const tokens = tokenize(standalone);
    assert.ok(tokens.some(token => token.kind === 'operator' && token.text === '-'));
    assert.deepEqual(parse(tokens, standalone).tokens, tokens);
});

test('normalizes section dividers between top-level statements and at EOF', () => {
    const source = 'select 1; -- prior\r\n  --------  \r\n-- Section\r\n---\r\nselect 2;\r\n-----';
    const expected = 'SELECT\r\n    1; -- prior\r\n\r\n-- ------  \r\n-- Section\r\n-- -\r\nSELECT\r\n    2;\r\n-- ---';
    assert.deepEqual(formatSqlResult(source), { sql: expected });
    assert.equal(formatSql(expected), expected);
    assert.equal(formatSql(source, { preserveComments: false }), 'SELECT\r\n    1;\r\n\r\nSELECT\r\n    2;');
});

test('preserves dashed custom delimiters, string contents, and routine arithmetic', () => {
    const custom = 'DELIMITER ----\nselect 1\n----\nDELIMITER ;';
    assert.deepEqual(formatSqlResult(custom), { sql: 'DELIMITER ----\nSELECT\n    1----\nDELIMITER ;' });
    const routine = "create procedure p() begin select 'first\n----\nlast'; select 7\n----\n2; end;";
    const tokens = tokenize(routine);
    assert.deepEqual(parse(tokens, routine).tokens, tokens);
    assert.match(formatSql(routine), /'first\n----\nlast'/);
});

function selectText(source: string, text: string, settings?: Partial<FormatterSettings>) {
    const start = source.indexOf(text);
    assert.ok(start >= 0);
    return formatSqlSelection(source, start, start + text.length, settings);
}

test('preserves nested clause selection spacing and surrounding text', () => {
    const selected = 'where a=1 and b=\n\n  2';
    const input = 'select (\n  select a from b\n  ' + selected + '\n);\nselect untouched;';
    const expected = 'WHERE\n      a = 1\n      AND b =\n\n      2';
    assert.deepEqual(selectText(input, selected), { sql: expected });
    assert.deepEqual(selectText(input.replace(selected, expected), expected), { sql: expected });
    assert.deepEqual(selectText(input, selected, { preserveBlankLines: false }), { sql: 'WHERE\n      a = 1\n      AND b = 2' });
});

test('resolves ignored regions using the full document for selections', () => {
    const region = '  -- sql-beautifier-ignore\nselect    1;';
    const input = 'select 0;\n' + region + '\nselect 2;\nselect 3;';
    assert.deepEqual(selectText(input, 'select    1;'), { sql: 'select    1;' });
    assert.deepEqual(selectText(input, 'lect    1'), { sql: 'lect    1' });
    assert.deepEqual(selectText(input, region + '\nselect 2;'), { sql: region + '\n\nSELECT\n    2;' });
    assert.match(selectText(input, 'select    1;\nselect 2;').error ?? '', /cuts through an ignored SQL statement/);
});

test('formats selected statements and clauses around a section divider', () => {
    const source = 'select 1;\n--------\nselect id from t where x=1;\nselect 3;';
    assert.deepEqual(selectText(source, 'select id from t where x=1;'), { sql: 'SELECT\n    id\nFROM\n    t\nWHERE\n    x = 1;' });
    assert.deepEqual(selectText(source, '--------\nselect id from t where x=1;'), { sql: '-- ------\nSELECT\n    id\nFROM\n    t\nWHERE\n    x = 1;' });
    assert.deepEqual(selectText(source, 'where x=1'), { sql: 'WHERE\n    x = 1' });
    const insideDivider = source.indexOf('--------') + 2;
    assert.match(formatSqlSelection(source, insideDivider, source.indexOf('select 3;')).error ?? '', /cuts through a SQL token/);
});

test('formats selected statements and keeps the unselected semicolon and CRLF', () => {
    const source = 'select 0;\r\nselect a;select b from t;\r\nselect 3;';
    const selected = 'select a;select b from t';
    const result = selectText(source, selected, { trailingSemicolon: 'always' });
    assert.deepEqual(result, { sql: 'SELECT\r\n    a;\r\n\r\nSELECT\r\n    b\r\nFROM\r\n    t' });
    assert.equal(source.replace(selected, result.sql),
        'select 0;\r\nSELECT\r\n    a;\r\n\r\nSELECT\r\n    b\r\nFROM\r\n    t;\r\nselect 3;');
    assert.deepEqual(selectText(source, 'select a;', { trailingSemicolon: 'never' }), { sql: 'SELECT\r\n    a;' });
});

test('formats whole clauses in context and leaves surrounding SQL byte-for-byte', () => {
    const original = 'select id Alias from t where x=1 and y=2 order by id limit 3 offset 2;';
    assert.deepEqual(selectText(original, 'select id Alias'), { sql: 'SELECT\n    id AS Alias' });
    assert.deepEqual(selectText(original, 'offset 2;'), { sql: 'OFFSET\n    2;' });
    const selection = 'where x=1 and y=2 order by id';
    const result = selectText(original, selection);
    const expected = 'WHERE\n    x = 1\n    AND y = 2\nORDER BY\n    id';
    assert.deepEqual(result, { sql: expected });
    const formatted = original.replace(selection, result.sql);
    assert.equal(formatted, 'select id Alias from t ' + expected + ' limit 3 offset 2;');
    assert.deepEqual(selectText(formatted, expected), result);
    assert.deepEqual(selectText('update t set a=1,b=2 where x=1;', 'set a=1,b=2'), { sql: 'SET\n    a = 1,\n    b = 2' });
    assert.deepEqual(selectText('insert into t values (1) returning id,name;', 'returning id,name', { dialect: 'mariadb' }),
        { sql: 'RETURNING\n    id,\n    name' });
});

test('formats nested clauses using the existing indentation and keeps multiline literal bytes', () => {
    const selected = "where c='text\n  still literal' and d=2";
    const input = 'select (\n  select a from b\n  ' + selected + '\n);\nselect untouched;';
    assert.deepEqual(selectText(input, selected), { sql: "WHERE\n      c = 'text\n  still literal'\n      AND d = 2" });
});

test('rejects partial clauses, cut tokens, cross-query clause fragments, and partial custom-delimiter scripts', () => {
    const sql = 'select a,b from t where x=1 and y=2; select c from d;';
    for (const fragment of ['where x=1', 'here x=1 and y=2', 'a,b', 'where x=1 and y=2; select c']) {
        const result = selectText(sql, fragment);
        assert.equal(result.sql, fragment);
        assert.ok(result.error, fragment);
    }
    const custom = 'DELIMITER $$\nSELECT a$$\nDELIMITER ;\n';
    assert.match(selectText(custom, 'SELECT a$$').error ?? '', /DELIMITER/);
});

test('formats a selection with the reported header without touching later statements', () => {
    const selected = fixture('header', 'input').trimEnd();
    const input = selected + '\nselect afterwards;';
    assert.deepEqual(selectText(input, selected), { sql: fixture('header', 'expected').trimEnd() });
});
