import { defaults, FormatterSettings } from '../configuration/settings';
import { lineBreakCount, retainBlankLines, Writer } from './indentation';
import { assertStatement, code, Group, ignoresFile, implicitAlias, label, Node, parse, routineBody, Statement } from './parser';
import { functions, joinHeads, keywords, logical, modifiers, statementStarts, windowHeads } from './rules';
import { isExecutableComment, isLineComment, isProtectedComment, SqlFormatError, Token, tokenize } from './tokenizer';

export type FormatResult = { sql: string; error?: string };

type Layout = 'statement' | 'expression' | 'condition' | 'window' | 'windowDefinition' | 'ddl' | 'list' | 'routine';

const doubleClauses = new Set(['GROUP', 'ORDER']);
const simpleClauses = new Set(['SELECT', 'FROM', 'WHERE', 'HAVING', 'LIMIT', 'SET', 'VALUES']);
const conditions = new Set(['WHERE', 'HAVING', 'ON']);
const listClauses = new Set(['SELECT', 'WITH', 'FROM', 'GROUP', 'ORDER', 'SET', 'VALUES', 'RETURNING', 'ALTER']);
const selectableClauses = new Set(['SELECT', 'FROM', 'JOIN', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'SET', 'VALUES', 'WINDOW', 'RETURNING']);
const queryStarts = new Set(['SELECT', 'WITH', 'UPDATE', 'DELETE', 'INSERT', 'REPLACE', 'VALUES']);
const alterActions = new Set(['ADD', 'ALTER', 'CHANGE', 'CONVERT', 'DROP', 'MODIFY', 'RENAME']);
const types = new Set(['BOOL', 'BOOLEAN', 'DATE', 'DATETIME', 'ENUM', 'JSON', 'TEXT', 'TIME', 'TIMESTAMP']);
const compoundBranches = new Set(['BEGIN', 'ELSE', 'ELSEIF', 'END', 'IF', 'LOOP', 'REPEAT', 'UNTIL', 'WHEN', 'WHILE']);
const spacedBeforeGroup = new Set([
    'ALL', 'AND', 'AS', 'BETWEEN', 'BY', 'CASE', 'DISTINCT', 'ELSE', 'EXISTS', 'FROM', 'HAVING', 'IN',
    'JOIN', 'NOT', 'ON', 'OR', 'OVER', 'SELECT', 'SET', 'THEN', 'UNION', 'USING', 'WHEN', 'WHERE', 'WITH',
]);
const contextualKeywords = new Set([
    'ACTION', 'AFTER', 'ALGORITHM', 'AUTO_INCREMENT', 'BEGIN', 'CHARSET', 'COMMENT', 'COMMIT', 'COMMITTED', 'CONNECTION', 'DEALLOCATE',
    'CURRENT', 'DEFINER', 'DELIMITER', 'DO', 'DUPLICATE', 'END', 'ENGINE', 'EXECUTE', 'FOLLOWING', 'FORMAT', 'FOUND',
    'HANDLER', 'INVOKER', 'ISOLATION', 'LANGUAGE', 'MODE', 'NEXT', 'OFFSET', 'ONLY', 'PRECEDING',
    'PREPARE', 'REPEATABLE', 'RETURNING', 'RETURNS', 'ROLLBACK', 'SAVEPOINT', 'SECURITY', 'SERIALIZABLE',
    'SHARE', 'START', 'TEMPORARY', 'TRANSACTION', 'UNBOUNDED', 'UNCOMMITTED', 'UNTIL', 'VIEW', 'WORK', 'SKIP', 'LOCKED',
]);
const unary = new Set(['+', '-', '!', '~']);
const tokenEnd = (node: Node): number => node.kind === 'group' ? node.close.end : node.end;
const tokenStart = (node: Node): number => node.kind === 'group' ? node.open.start : node.start;
const changeCase = (value: string, mode: FormatterSettings['keywordCase']): string =>
    mode === 'upper' ? value.toUpperCase() : mode === 'lower' ? value.toLowerCase() : value;

interface Span { start: number; end: number }
interface ClauseSpan extends Span { selectable: boolean }
interface SelectionTrace {
    blocks: ClauseSpan[][];
    output: Map<number, Span>;
    lineStarts: number[];
}

interface FormatBehavior {
    inSelection?: boolean;
    overrideIgnore?: boolean;
}

const selectionBehavior: FormatBehavior = { inSelection: true, overrideIgnore: true };

const hasStatementContent = (nodes: Node[]): boolean =>
    nodes.some(node => node.kind !== 'comment' || isExecutableComment(node));

function assertSqlMode(tokens: Token[]): void {
    for (const token of tokens) {
        if (token.kind === 'parameter' && /^@@(?:\w+\.)?sql_mode$/i.test(token.text)
            || token.kind === 'word' && label(token) === 'SQL_MODE') {
            throw new SqlFormatError('Scripts referencing SQL_MODE are kept unchanged.');
        }
        if (isProtectedComment(token) && /\bSQL_MODE\b/i.test(token.text)) {
            throw new SqlFormatError('An executable comment references SQL_MODE.');
        }
    }
}

class Formatter {
    private readonly writer: Writer;
    private readonly replacements = new Map<number, string>();
    private readonly before = new Map<number, string>();
    private readonly after = new Map<number, string>();
    private readonly aliases = new Set<number>();
    private readonly ignoreDirectives = new Set<number>();

    constructor(private readonly settings: FormatterSettings, private readonly eol: string, private readonly source: string,
        private readonly trace?: SelectionTrace) {
        this.writer = new Writer(settings, eol);
    }

    format(inputTokens: Token[], { inSelection = false, overrideIgnore = false }: FormatBehavior): string {
        if (inputTokens.length === 0) return this.source;
        assertSqlMode(inputTokens);
        const { parts, tokens } = parse(inputTokens, this.source);
        if (overrideIgnore) {
            if (ignoresFile(this.source)) this.ignoreDirectives.add(tokens[0].start);
            for (const part of parts) {
                if (!('kind' in part) && part.ignored) this.ignoreDirectives.add(part.ignored.directive.start);
            }
        }
        const containsIgnored = !overrideIgnore && parts.some(part => !('kind' in part) && part.ignored);
        const lastStatement = parts.findLast(part => !('kind' in part) && hasStatementContent(part.nodes));
        const adjacent = new Set<number>();
        if (inSelection && parts.some(part => 'kind' in part || part.customDelimiter)) {
            throw new SqlFormatError('Format the whole document to change a DELIMITER script.');
        }
        let precededByStatement = false;
        for (const [i, part] of parts.entries()) {
            if ('kind' in part) {
                this.writer.newline();
                this.replacements.set(part.start, changeCase(part.text.slice(0, 9), this.settings.keywordCase) + part.text.slice(9));
                this.writeToken(part, 0, false);
                this.writer.newline();
                precededByStatement = false;
                continue;
            }
            const trailing = part.nodes[0];
            if (i > 0 && trailing?.kind === 'comment' && !isProtectedComment(trailing)
                && !trailing.lineBreakBefore && this.writer.hasText) {
                this.comment(trailing, 0);
                adjacent.add(trailing.start);
            }
            const substantive = hasStatementContent(part.nodes);
            if (precededByStatement && substantive) this.writer.blankLine();
            else this.writer.newline();
            this.statement(part, part === lastStatement, adjacent, overrideIgnore);
            precededByStatement ||= substantive;
        }

        let sql = this.writer.finish();
        let starts = this.writer.lineStarts();
        const align = (output: string): Map<number, Span> => {
            const actual = tokenize(output);
            const lexemes = containsIgnored ? parse(actual, output).tokens : actual;
            return this.matchTokens(tokens, lexemes);
        };
        let spans = align(sql);
        if (this.settings.preserveBlankLines) {
            const retained = retainBlankLines(this.source, tokens, spans, sql, starts, this.eol, !this.trace);
            if (retained.sql !== sql) spans = align(retained.sql);
            ({ sql, lineStarts: starts } = retained);
        }
        if (this.trace) {
            this.trace.output = spans;
            this.trace.lineStarts = starts;
        }
        return sql;
    }

    private matchTokens(tokens: Token[], actual: Token[]): Map<number, Span> {
        const spans = new Map<number, Span>();
        let i = 0;
        for (const token of tokens) {
            const start = i;
            const prefix = this.before.get(token.start);
            const suffix = this.after.get(token.start);
            const expected = this.replacements.get(token.start) ?? token.text;
            for (const text of [prefix, expected, suffix]) {
                if (text && actual[i++]?.text !== text) {
                    throw new SqlFormatError('Formatting would change SQL token boundaries.');
                }
            }
            if (i > start) spans.set(token.start, { start: actual[start].start, end: actual[i - 1].end });
        }
        if (i !== actual.length) throw new SqlFormatError('Formatting would add unexpected SQL tokens.');
        return spans;
    }

    private statement(part: Statement, last: boolean, adjacent: Set<number>, overrideIgnore: boolean): void {
        const nodes = part.nodes.filter(node => node.kind === 'group' || !adjacent.has(node.start));
        if (part.ignored && !overrideIgnore) {
            const prefix = nodes.slice(0, nodes.indexOf(part.ignored.directive));
            this.sequence(prefix, 0, 'expression');
            this.writer.newline();
            this.writer.write(this.source.slice(part.ignored.start, part.ignored.end), 0);
            return;
        }
        assertStatement(nodes);
        const routine = routineBody(nodes);
        const lastContent = nodes.findLastIndex(node => node.kind !== 'comment' || isExecutableComment(node));
        const addEnd = last && lastContent >= 0 && !part.end && !part.customDelimiter && this.settings.trailingSemicolon === 'always';
        const hasTrailingComments = !part.end && lastContent >= 0 && lastContent < nodes.length - 1;
        const content = hasTrailingComments ? nodes.slice(0, lastContent + 1) : nodes;
        if (routine < 0) this.sequence(content, 0, 'statement');
        else this.routine(content, routine);
        if (part.end) {
            if (last && !part.customDelimiter && this.settings.trailingSemicolon === 'never') {
                this.replacements.set(part.end.start, '');
            } else {
                this.writeToken(part.end, 0, false);
            }
        } else if (addEnd) {
            const lastNode = nodes[lastContent];
            const token = lastNode.kind === 'group' ? lastNode.close : lastNode;
            this.after.set(token.start, ';');
            this.writer.write(';', 0);
        }
        if (hasTrailingComments) {
            for (const node of nodes.slice(lastContent + 1)) this.comment(node as Token, 0);
        }
    }

    private routine(nodes: Node[], start: number): void {
        let headerEnd = start;
        if (label(nodes[start - 1]) === ':' && nodes[start - 2]?.kind === 'word') headerEnd -= 2;
        this.sequence(nodes.slice(0, headerEnd), 0, 'statement');
        this.writer.newline();
        this.sequence(nodes.slice(headerEnd, start + 1), 0, 'routine');
        this.writer.newline();
        let level = 1;
        let atStart = true;
        let chunk: Node[] = [];
        const caseLevels: number[] = [];
        const flush = (): void => {
            this.sequence(chunk, level, 'statement');
            chunk = [];
        };
        for (let i = start + 1; i < nodes.length; i++) {
            const node = nodes[i];
            const name = label(node);
            const next = label(nodes[i + 1]);
            if (atStart && compoundBranches.has(name) && !(name === 'IF' && next === '(' && label(nodes[i + 2]) === ';')) {
                flush();
                if (name === 'END' && next === 'CASE' && caseLevels.length) level = caseLevels.pop()!;
                else if (['END', 'ELSE', 'ELSEIF', 'UNTIL', 'WHEN'].includes(name)) level = Math.max(0, level - 1);
                if (name === 'END') {
                    chunk.push(node);
                    if (['IF', 'CASE', 'WHILE', 'REPEAT', 'LOOP'].includes(next)) chunk.push(nodes[++i]);
                    atStart = false;
                    continue;
                }
                if (['BEGIN', 'ELSE', 'LOOP', 'REPEAT'].includes(name)) {
                    this.node(node, level, 'expression', undefined, nodes[i + 1], name);
                    this.writer.newline();
                    level++;
                    continue;
                }
            }
            if (atStart && name === 'CASE') {
                caseLevels.push(level);
                chunk.push(node);
                atStart = false;
                continue;
            }
            if (name === 'WHEN' && label(code(chunk)[0]) === 'CASE') {
                flush();
                this.writer.newline();
                level++;
            }
            if ((name === 'THEN' || name === 'DO') && ['IF', 'ELSEIF', 'WHILE', 'WHEN'].includes(label(code(chunk)[0]))) {
                chunk.push(node);
                flush();
                this.writer.newline();
                level++;
                atStart = true;
                continue;
            }
            if (name === ';') {
                flush();
                this.writeToken(node as Token, level, false);
                this.writer.newline();
                atStart = true;
            } else {
                chunk.push(node);
                if (node.kind !== 'comment') atStart = false;
            }
        }
        flush();
    }

    private clause(nodes: Node[], i: number, clause: string, root: string): number {
        const node = nodes[i];
        const previous = label(nodes[i - 1]);
        const next = label(nodes[i + 1]);
        const name = label(node);
        if (node.kind !== 'word' || previous === '.' || next === '.'
            || previous === 'AS' && !(root === 'CREATE' && ['SELECT', 'WITH'].includes(name))) return 0;
        if (doubleClauses.has(name)) return next === 'BY' ? 2 : 0;
        if (name === 'GROUP' || name === 'ORDER') return 0;
        if (name === 'SET') return i > 0 && ['UPDATE', 'INSERT', 'REPLACE'].includes(root) && previous !== 'CHARACTER' ? 1 : 0;
        if (name === 'FROM' && root === 'PREPARE') return 0;
        if (name === 'VALUES') {
            return ['INSERT', 'REPLACE'].includes(root) && !['UPDATE', 'SET'].includes(clause) ? 1 : i === 0 ? 1 : 0;
        }
        if (name === 'OFFSET') return clause === 'LIMIT' && next !== ',' ? 1 : 0;
        if (name === 'WINDOW') return ['SELECT', 'WITH', 'CREATE'].includes(root) ? 1 : 0;
        if (name === 'RETURNING') {
            return this.settings.dialect === 'mariadb' && ['INSERT', 'REPLACE', 'DELETE'].includes(root)
                && previous !== ',' && next !== ',' && i > 0 && i + 1 < nodes.length ? 1 : 0;
        }
        if (name === 'INTO') return clause === 'SELECT' && root === 'SELECT' ? 1 : 0;
        if (name === 'WITH') return i === 0 || root === 'CREATE' && previous === 'AS'
            || ['INSERT', 'REPLACE'].includes(root) && clause === '' ? 1 : 0;
        if (name === 'ON' && next === 'DUPLICATE' && label(nodes[i + 2]) === 'KEY' && label(nodes[i + 3]) === 'UPDATE') return 4;
        if (name === 'FOR' && ['UPDATE', 'SHARE'].includes(next)) return 2;
        if (name === 'UNION' || name === 'INTERSECT' || name === 'EXCEPT') return ['ALL', 'DISTINCT'].includes(next) ? 2 : 1;
        if (joinHeads.has(name) && clause !== 'SELECT') {
            if (name === 'JOIN' || name === 'STRAIGHT_JOIN') return 1;
            for (let j = i + 1; j < Math.min(i + 4, nodes.length); j++) {
                const word = label(nodes[j]);
                if (word === 'JOIN') return j - i + 1;
                if (!['INNER', 'LEFT', 'RIGHT', 'OUTER'].includes(word)) break;
            }
        }
        return simpleClauses.has(name) ? 1 : 0;
    }

    private sequence(nodes: Node[], base: number, layout: Layout, preserveOutputNames = false): void {
        let root = label(nodes.find(node => node.kind !== 'comment'));
        const view = root === 'CREATE' ? nodes.findIndex(node => label(node) === 'VIEW') : -1;
        const viewAs = view >= 0 ? nodes.findIndex((node, i) => i > view && label(node) === 'AS') : -1;
        const namedOutput = preserveOutputNames || viewAs >= 0 && nodes[viewAs - 1]?.kind !== 'group';
        let level = base;
        let clause = '';
        let previous: Node | undefined;
        let between = false;
        let selectStart = -1;
        let selectModifiers = false;
        let clauseNeedsContent = false;
        let pendingBreak = false;
        let selectExpression = false;
        let onLevel: number | undefined;
        let unaryBefore = false;
        let rawThrough = -1;
        const clauses: ClauseSpan[] | undefined = this.trace && layout === 'statement' ? [] : undefined;
        let clauseStart = -1;
        const recordClause = (end: number): void => {
            if (!clauses || clauseStart < 0) return;
            while (end > clauseStart && nodes[end - 1].kind === 'comment' && !isExecutableComment(nodes[end - 1] as Token)) end--;
            clauses.push({ start: tokenStart(nodes[clauseStart]), end: tokenEnd(nodes[end - 1]), selectable: selectableClauses.has(clause) });
        };

        const alias = (end: number): void => {
            if (selectStart < 0 || !namedOutput && !this.settings.explicitColumnAliases) return;
            const expression = nodes.slice(selectStart, end);
            const inferred = implicitAlias(expression);
            if (inferred && inferred.kind !== 'group') {
                if (this.settings.explicitColumnAliases) this.aliases.add(inferred.start);
                return;
            }
            if (!namedOutput) return;
            const items = code(expression);
            const explicit = label(items.at(-2)) === 'AS';
            const column = items.length > 0 && items.every((item, index) => index % 2
                ? label(item) === '.' : item.kind === 'word' && (index > 0 || !keywords.has(label(item)))
                    || item.kind === 'quoted' || label(item) === '*');
            // MySQL derives a visible column name from the exact text of an unnamed expression.
            if (!explicit && !column) rawThrough = selectStart + expression.findLastIndex(item => item.kind !== 'comment' || isExecutableComment(item));
        };

        // Find aliases before writing each SELECT expression, ignoring commas within CASE and groups.
        const findAlias = (start: number): void => {
            selectStart = start;
            let cases = 0;
            for (let j = start; j < nodes.length; j++) {
                const name = label(nodes[j]);
                if (name === 'CASE') cases++;
                if (name === 'END' && cases) cases--;
                if (!cases && (name === ',' || this.clause(nodes, j, 'SELECT', root))) {
                    alias(j);
                    return;
                }
            }
            alias(nodes.length);
        };

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const name = label(node);
            const next = nodes[i + 1];
            if (node.kind === 'comment') {
                this.comment(node, level);
                continue;
            }

            if (selectModifiers) {
                if (modifiers.has(name)) {
                    this.node(node, level, layout, previous, next, name);
                    previous = node;
                    continue;
                }
                selectModifiers = false;
                if (this.settings.clauseContentOnNewLine) this.writer.newline();
                findAlias(i);
            } else if (pendingBreak) {
                this.writer.newline();
                pendingBreak = false;
            }

            if (layout === 'statement' && clause === 'WITH' && previous?.kind === 'group'
                && ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(name)) {
                recordClause(i);
                clauseStart = -1;
                this.writer.newline();
                root = name;
                clause = '';
            }
            if (layout === 'statement' && root === 'ALTER' && !clause && i > 2 && alterActions.has(name)) {
                this.writer.newline();
                clause = 'ALTER';
                level = base + 1;
            }

            const length = layout === 'statement' ? this.clause(nodes, i, clause, root) : 0;
            if (length) {
                if (selectExpression && clause === 'SELECT' && !between && name !== 'SELECT' && label(previous) === ',') {
                    throw new SqlFormatError('Expected a SELECT expression after the comma.');
                }
                if (clauseNeedsContent || clause === 'SELECT' && !selectExpression
                    || previous?.kind === 'operator' && label(previous) !== '*') {
                    throw new SqlFormatError('Expected SQL clause contents.');
                }
                this.writer.newline();
                recordClause(i);
                clauseStart = i;
                clause = name === 'ON' ? 'UPDATE' : joinHeads.has(name) ? 'JOIN' : name;
                between = false;
                onLevel = undefined;
                for (let j = 0; j < length; j++) {
                    this.node(nodes[i + j], base, layout, j ? nodes[i + j - 1] : undefined, nodes[i + j + 1], label(nodes[i + j]));
                }
                const isJoin = clause === 'JOIN';
                const indent = isJoin ? this.settings.joinTableOnNewLine : this.settings.clauseContentOnNewLine;
                const alone = ['WITH', 'UNION', 'INTERSECT', 'EXCEPT', 'FOR'].includes(clause);
                level = indent && !alone ? base + 1 : base;
                selectModifiers = clause === 'SELECT';
                selectExpression = false;
                clauseNeedsContent = !alone && !selectModifiers;
                pendingBreak = indent && clauseNeedsContent;
                i += length - 1;
                previous = nodes[i];
                continue;
            }

            if (rawThrough >= i) {
                const last = nodes[rawThrough];
                this.writer.write(this.source.slice(tokenStart(node), tokenEnd(last)), level, !!previous);
                selectExpression = true;
                previous = last;
                i = rawThrough;
                rawThrough = -1;
                continue;
            }

            if (clauseNeedsContent && [',', 'AND', 'OR', 'ON'].includes(name)) {
                throw new SqlFormatError('Expected SQL clause contents.');
            }
            clauseNeedsContent = false;

            if (name === ',' && (listClauses.has(clause) || ['ddl', 'list'].includes(layout) || root === 'ALTER')) {
                if (previous?.kind === 'operator' && label(previous) !== '*') {
                    throw new SqlFormatError('Expected a SQL expression before the comma.');
                }
                const multiline = clause === 'SELECT' ? this.settings.oneColumnPerLine : true;
                const wrap = multiline || this.writer.width + this.estimate(nodes.slice(i + 1, this.listEnd(nodes, i + 1, clause, root))) + 2 > this.settings.maxLineLength;
                if (wrap && this.settings.commaPosition === 'leading') this.writer.newline();
                this.node(node, level, layout, previous, next);
                if (wrap && this.settings.commaPosition === 'trailing') this.writer.newline();
                if (clause === 'SELECT') {
                    if (!selectExpression || !next) throw new SqlFormatError('Expected a SELECT expression at the comma.');
                    selectExpression = false;
                    findAlias(i + 1);
                }
                previous = node;
                unaryBefore = false;
                continue;
            }

            if (name === 'ON' && clause === 'JOIN' && label(previous) !== '.') {
                const end = this.listEnd(nodes, i + 1, clause, root);
                const predicate = nodes.slice(i + 1, end);
                if (!code(predicate).length) throw new SqlFormatError('Expected a JOIN condition.');
                const complex = this.hasLogical(predicate) || this.writer.width + 4 + this.estimate(predicate) > this.settings.maxLineLength;
                if (complex) {
                    onLevel = level + 1;
                    this.writer.newline();
                } else {
                    onLevel = level;
                }
            }

            const condition = layout === 'condition' || conditions.has(clause) || onLevel !== undefined;
            const atLevel = onLevel ?? level;
            const qualified = label(previous) === '.' || label(next) === '.';
            const operator = !qualified && (logical.has(name) || name === '&&');
            if (!qualified && name === 'BETWEEN') between = true;
            const betweenAnd = between && name === 'AND';
            if (betweenAnd) between = false;
            if (operator && condition && !betweenAnd && this.settings.breakBeforeLogicalOperator) this.writer.newline();

            if (name === 'CASE') {
                const end = this.caseEnd(nodes, i);
                if (end >= 0) {
                    const nested = ['THEN', 'ELSE'].includes(label(previous));
                    this.caseExpression(nodes.slice(i, end + 1), nested ? atLevel + 1 : atLevel);
                    previous = nodes[end];
                    i = end;
                    selectExpression = true;
                    continue;
                }
            }
            const aliasToken = node.kind !== 'group' && this.aliases.has(node.start);
            if (aliasToken) {
                const as = changeCase('AS', this.settings.keywordCase);
                this.before.set(node.start, as);
                this.writer.write(as, atLevel, true);
            }
            const isUnary = unary.has(name) && (['!', '~'].includes(name) || !previous
                || previous.kind === 'operator' && label(previous) !== '*'
                || ['SELECT', 'WHERE', 'AND', 'OR', 'WHEN', 'THEN', ',', 'BY', 'AS', 'ON'].includes(label(previous)));
            const prior = label(previous);
            const relationName = ['INTO', 'TABLE', 'VIEW', 'PROCEDURE', 'TRIGGER', 'REFERENCES'].includes(prior)
                    && !(name === 'IF' && label(next) === 'NOT' || name === 'TABLE' && prior === 'INTO')
                || root === 'CREATE' && ['FUNCTION', 'ON'].includes(prior) && name !== 'SELECT'
                || root === 'CREATE' && prior === 'EXISTS' && label(nodes[i - 2]) === 'NOT';
            const role = aliasToken || relationName || prior === 'AS' && !['WITH', ''].includes(clause)
                || clause === 'WITH' && ['WITH', 'RECURSIVE', ','].includes(prior) && name !== 'RECURSIVE'
                ? 'identifier' : (layout === 'ddl' && previous && types.has(name) || root === 'ROLLBACK' && prior === 'TO' && name === 'SAVEPOINT')
                    ? name : undefined;
            const preserveQueryNames = ['FROM', 'JOIN'].includes(clause)
                || clause === 'WITH' && prior === 'AS' && nodes[i - 2]?.kind !== 'group';
            this.node(node, atLevel, condition ? 'condition' : clause === 'WINDOW' ? 'windowDefinition' : layout,
                previous, next, role, unaryBefore, root, preserveQueryNames);
            unaryBefore = isUnary;
            previous = node;
            if (clause === 'SELECT') selectExpression = true;
            if (operator && condition && !betweenAnd && !this.settings.breakBeforeLogicalOperator) this.writer.newline();
        }
        if (selectModifiers || clauseNeedsContent) throw new SqlFormatError('Expected SQL clause contents.');
        recordClause(nodes.length);
        if (clauses?.length) this.trace?.blocks.push(clauses);
    }

    private isBetweenAnd(nodes: Node[], index: number): boolean {
        for (let i = index - 1; i >= 0; i--) {
            const name = label(nodes[i]);
            if (name === 'BETWEEN') return true;
            if (logical.has(name) || name === ',') return false;
        }
        return false;
    }

    private listEnd(nodes: Node[], start: number, clause: string, root: string): number {
        let i = start;
        for (; i < nodes.length; i++) {
            if (label(nodes[i]) === ',' || this.clause(nodes, i, clause, root)) break;
        }
        return i;
    }

    private hasLogical(nodes: Node[]): boolean {
        return nodes.some((node, index) => {
            const name = label(node);
            return (logical.has(name) && (name !== 'AND' || !this.isBetweenAnd(nodes, index)))
                || name === '&&' || node.kind === 'group' && this.hasLogical(node.nodes);
        });
    }

    private estimate(nodes: Node[]): number {
        return nodes.reduce((length, node) => length
            + (node.kind === 'group' ? this.estimate(node.nodes) + 2 : node.text.length) + 1, 0);
    }

    private caseEnd(nodes: Node[], start: number): number {
        let depth = 0;
        for (let i = start; i < nodes.length; i++) {
            const name = label(nodes[i]);
            if (name === 'CASE') depth++;
            if (name === 'END' && --depth === 0) return i;
        }
        return -1;
    }

    private caseExpression(nodes: Node[], level: number): void {
        let start = 0;
        let nested = 0;
        this.writer.newline();
        for (let i = 1; i < nodes.length; i++) {
            const name = label(nodes[i]);
            if (name === 'CASE') nested++;
            if (name === 'END' && nested) {
                nested--;
                continue;
            }
            if (!nested && ['WHEN', 'THEN', 'ELSE', 'END'].includes(name)) {
                this.sequence(nodes.slice(start, i), start === 0 ? level : level + 1,
                    label(nodes[start]) === 'WHEN' ? 'condition' : 'expression');
                this.writer.newline();
                start = i;
            }
        }
        this.node(nodes[start], level, 'expression', undefined, undefined, 'END');
    }

    private window(group: Group, level: number): void {
        const nodes = group.nodes;
        const starts = nodes.flatMap((node, i) => windowHeads.has(label(node)) && label(nodes[i - 1]) !== '.' ? [i] : []);
        if (starts.length <= 1 && !nodes.some(node => node.kind === 'comment')
            && this.writer.width + this.estimate(nodes) + 2 <= this.settings.maxLineLength) {
            this.sequence(nodes, level, 'window');
            return;
        }
        const boundaries = [...new Set([0, ...starts, nodes.length])];
        for (let i = 1; i < boundaries.length; i++) {
            this.writer.newline();
            this.sequence(nodes.slice(boundaries[i - 1], boundaries[i]), level + 1, 'window');
        }
        this.writer.newline();
    }

    private node(node: Node, level: number, layout: Layout, previous?: Node, next?: Node, role?: string,
        afterUnary = false, root = '', preserveQueryNames = false): void {
        const name = label(node);
        const prior = label(previous);
        if (node.kind === 'group') {
            const first = code(node.nodes)[0];
            const query = queryStarts.has(label(first));
            const ddl = root === 'CREATE' && code(node.nodes).some(item => ['PRIMARY', 'KEY', 'DEFAULT', 'CONSTRAINT'].includes(label(item))
                || ['INT', 'VARCHAR', 'BIGINT', 'DECIMAL', 'TEXT', 'DATETIME', 'TIMESTAMP', 'JSON'].includes(label(item)));
            const nestedCondition = layout === 'condition' && this.hasLogical(node.nodes);
            const wrapList = node.nodes.some(item => label(item) === ',')
                && this.writer.width + this.estimate(node.nodes) + 2 > this.settings.maxLineLength;
            const structural = spacedBeforeGroup.has(prior) && (!functions.has(prior) || tokenEnd(previous!) !== node.open.start);
            const space = !!previous && (previous.kind !== 'word' && previous.kind !== 'quoted'
                || structural || tokenEnd(previous) !== node.open.start) && prior !== '.';
            this.writeToken(node.open, level, space);
            if (prior === 'OVER' || prior === 'AS' && layout === 'windowDefinition') {
                this.window(node, level);
            } else if (query || ddl || nestedCondition || wrapList) {
                if (query) assertStatement(node.nodes);
                this.writer.newline();
                this.sequence(node.nodes, level + 1, query ? 'statement' : ddl ? 'ddl' : nestedCondition ? 'condition' : 'list',
                    query && preserveQueryNames);
                this.writer.newline();
            } else {
                this.sequence(node.nodes, level, layout === 'window' ? 'window' : 'expression');
            }
            this.writeToken(node.close, level, false);
            return;
        }
        if (node.kind === 'comment') {
            this.comment(node, level);
            return;
        }
        const qualified = prior === '.' || label(next) === '.';
        if (node.kind === 'word') {
            const builtin = !role && !qualified && next?.kind === 'group' && functions.has(name)
                && node.end === next.open.start;
            const following = label(next);
            const contextual = contextualKeywords.has(name) && (
                layout === 'statement' && !previous && (statementStarts.has(name) || compoundBranches.has(name))
                || ['CREATE', 'ALTER'].includes(root) && ['ALGORITHM', 'AUTO_INCREMENT', 'CHARSET', 'CONNECTION', 'ENGINE'].includes(name) && following === '='
                || root === 'CREATE' && (['VIEW', 'RETURNS'].includes(name) || name === 'AFTER' && ['INSERT', 'UPDATE', 'DELETE'].includes(following))
                || name === 'BEGIN' && layout === 'routine'
                || name === 'DO' && root === 'WHILE'
                || name === 'TRANSACTION' && ['SET', 'START'].includes(prior)
                || name === 'TEMPORARY' && ['CREATE', 'DROP'].includes(prior) && following === 'TABLE'
                || name === 'PREPARE' && root === 'DEALLOCATE'
                || name === 'SKIP' && following === 'LOCKED' || name === 'LOCKED' && prior === 'SKIP'
                || name === 'CURRENT' && layout === 'window' && following === 'ROW'
                || ['UNBOUNDED', 'FOLLOWING', 'PRECEDING'].includes(name) && layout === 'window'
                || name === 'SECURITY' && prior === 'SQL' || prior === 'SECURITY' && ['DEFINER', 'INVOKER'].includes(name)
            );
            const isKeyword = role !== 'identifier' && !qualified && (role === name
                || keywords.has(name) || statementStarts.has(name) && (layout === 'statement' && !previous)
                || contextual);
            const callable = next?.kind === 'group' && node.end === next.open.start && !isKeyword;
            const mode = builtin ? this.settings.functionCase : isKeyword ? this.settings.keywordCase
                : callable ? 'preserve' : this.settings.identifierCase;
            this.replacements.set(node.start, changeCase(node.text, mode));
        }
        const tight = ['.', ':', ',', ';'].includes(name) || prior === '.' || afterUnary
            || name === '*' && prior === '.';
        this.writeToken(node, level, !!previous && !tight);
    }

    private comment(token: Token, level: number): void {
        if (!this.settings.preserveComments && !isProtectedComment(token) && !this.ignoreDirectives.has(token.start)) {
            this.replacements.set(token.start, '');
            return;
        }
        if (token.lineBreakBefore && !isProtectedComment(token)) this.writer.newline();
        if (token.bareDivider) this.replacements.set(token.start, `-- ${token.text.slice(2)}`);
        this.writeToken(token, level, true);
        if (isLineComment(token)) this.writer.newline();
    }

    private writeToken(token: Token, level: number, space: boolean): void {
        this.writer.write(this.replacements.get(token.start) ?? token.text, level, space);
    }
}

function settingsWithDefaults(options: Partial<FormatterSettings>): FormatterSettings {
    const settings: FormatterSettings = { ...defaults, ...options };
    settings.indentSize = Number.isFinite(settings.indentSize) ? Math.max(1, Math.min(16, Math.trunc(settings.indentSize))) : defaults.indentSize;
    settings.maxLineLength = Number.isFinite(settings.maxLineLength) ? Math.max(20, Math.min(500, Math.trunc(settings.maxLineLength))) : defaults.maxLineLength;
    return settings;
}

function formatWithEol(input: string, options: Partial<FormatterSettings>, behavior: FormatBehavior, preferredEol?: string): FormatResult {
    if (!behavior.inSelection && !behavior.overrideIgnore && ignoresFile(input)) return { sql: input };
    try {
        const settings = settingsWithDefaults(options);
        const bom = input.startsWith('\uFEFF') ? '\uFEFF' : '';
        const source = input.slice(bom.length);
        const tokens = tokenize(source);
        if (!tokens.length) return { sql: input };
        const eol = preferredEol ?? source.match(/\r\n|\r|\n/)?.[0] ?? '\n';
        const output = new Formatter(settings, eol, source).format(tokens, behavior);
        const repeated = new Formatter(settings, eol, output).format(tokenize(output), behavior);
        if (output !== repeated) throw new SqlFormatError('Formatting this SQL would produce an unstable layout.');
        const finalNewline = !settings.preserveBlankLines && output
            && /(?:\r\n|\r|\n)[ \t\r\n]*$/.test(source) && !/(?:\r\n|\r|\n)[ \t\r\n]*$/.test(output) ? eol : '';
        return { sql: bom + output + finalNewline };
    } catch (error) {
        if (error instanceof SqlFormatError) return { sql: input, error: error.message };
        throw error;
    }
}

export function formatSqlResult(input: string, options: Partial<FormatterSettings> = {}, inSelection = false): FormatResult {
    return formatWithEol(input, options, { inSelection });
}

function indentOfLine(source: string, offset: number): string {
    const start = Math.max(source.lastIndexOf('\n', offset - 1), source.lastIndexOf('\r', offset - 1)) + 1;
    return /^[ \t]*/.exec(source.slice(start, offset))![0];
}

function rebaseClause(output: string, span: Span, lineStarts: number[], indent: string): string {
    const lineStart = lineStarts.findLast(start => start <= span.start) ?? 0;
    const base = /^[ \t]*/.exec(output.slice(lineStart, span.start))![0];
    if (base === indent) return output.slice(span.start, span.end);
    let cursor = span.start;
    let result = '';
    for (const start of lineStarts) {
        if (start <= span.start || start >= span.end) continue;
        if (!output.startsWith(base, start) || ['\r', '\n'].includes(output[start])) continue;
        result += output.slice(cursor, start) + indent;
        cursor = start + base.length;
    }
    return result + output.slice(cursor, span.end);
}

function clauseSelection(source: string, selected: Token[], owner: Statement, tokens: Token[], settings: FormatterSettings): string {
    const trace: SelectionTrace = { blocks: [], output: new Map(), lineStarts: [] };
    const firstNode = owner.nodes[0];
    const lastNode = owner.nodes.at(-1)!;
    const start = tokenStart(firstNode);
    const end = owner.end?.end ?? tokenEnd(lastNode);
    const eol = source.match(/\r\n|\r|\n/)?.[0] ?? '\n';
    const formatter = new Formatter({ ...settings, trailingSemicolon: 'preserve' }, eol, source, trace);
    const output = formatter.format(tokens.filter(token => token.start >= start && token.end <= end), selectionBehavior);
    const syntax = selected.filter(token => token.kind !== 'comment' || isExecutableComment(token));
    const first = syntax[0];
    const last = syntax.at(-1);
    if (!first || !last || !trace.blocks.some(block => {
        const from = block.findIndex(clause => clause.start === first.start);
        const to = block.findIndex(clause => clause.end === last.end || last === owner.end && clause.end === syntax.at(-2)?.end);
        return from >= 0 && to >= from && block.slice(from, to + 1).every(clause => clause.selectable);
    })) throw new SqlFormatError('Select complete SQL statements or whole clauses.');
    const mapped = selected.flatMap(token => {
        const span = trace.output.get(token.start);
        return span ? [span] : [];
    });
    if (mapped.length === 0) return '';
    return rebaseClause(output, { start: mapped[0].start, end: mapped[mapped.length - 1].end },
        trace.lineStarts, indentOfLine(source, first.start));
}

/** Returns replacement text for the selected offsets in the original document. */
export function formatSqlSelection(source: string, start: number, end: number, options: Partial<FormatterSettings> = {}): FormatResult {
    const input = source.slice(start, end);
    if (!input.trim()) return { sql: input };
    if (start === 0 && end === source.length) return formatWithEol(source, options, { overrideIgnore: true });
    try {
        const inputTokens = tokenize(source);
        assertSqlMode(inputTokens);
        const { parts, tokens } = parse(inputTokens, source);
        if (inputTokens.some(token => token.kind === 'directive')) {
            throw new SqlFormatError('Format the whole document when it contains DELIMITER directives.');
        }
        const cutsBoundary = (token: Token, from: number, to: number): boolean =>
            (token.start < from && token.end > from) || (token.start < to && token.end > to);
        if (tokens.some(token => cutsBoundary(token, start, end))) throw new SqlFormatError('The selection cuts through a SQL token.');
        const selected = tokens.filter(token => token.start >= start && token.end <= end);
        if (!selected.length) return { sql: input };

        const statements = parts.flatMap(part => {
            if ('kind' in part) return [];
            const syntax = part.nodes.filter(node => node.kind !== 'comment' || isExecutableComment(node));
            return syntax.length ? [{
                part,
                beginning: tokenStart(syntax[0]),
                contentEnd: tokenEnd(syntax[syntax.length - 1]),
                end: part.end?.end ?? tokenEnd(syntax[syntax.length - 1]),
            }] : [];
        });
        const touched = statements.filter(statement => statement.beginning < end && statement.end > start);
        if (!touched.length) return { sql: input };
        const settings = settingsWithDefaults(options);
        const first = selected[0].start;
        const last = selected[selected.length - 1].end;
        let formatted: string;
        if (touched.every(statement => start <= statement.beginning && end >= statement.contentEnd)) {
            if (statements.some(statement => statement.end > end)) settings.trailingSemicolon = 'preserve';
            const result = formatWithEol(source.slice(first, last), settings, selectionBehavior, source.match(/\r\n|\r|\n/)?.[0]);
            if (result.error) throw new SqlFormatError(result.error);
            formatted = result.sql;
        } else if (touched.length === 1) {
            formatted = clauseSelection(source, selected, touched[0].part, tokens, settings);
        } else {
            throw new SqlFormatError('Select complete SQL statements or whole clauses.');
        }

        const after = first + formatted.length;
        const updated = source.slice(0, first) + formatted + source.slice(last);
        const result = parse(tokenize(updated), updated).tokens;
        const exterior = (list: Token[], from: number, to: number): string =>
            JSON.stringify(list.filter(token => token.end <= from || token.start >= to).map(token => [token.kind, token.text]));
        if (result.some(token => cutsBoundary(token, first, after))
            || exterior(tokens, first, last) !== exterior(result, first, after)) {
            throw new SqlFormatError('Formatting would change SQL tokens outside the selection.');
        }
        return { sql: source.slice(start, first) + formatted + source.slice(last, end) };
    } catch (error) {
        if (error instanceof SqlFormatError) return { sql: input, error: error.message };
        throw error;
    }
}

export function formatSql(input: string, options?: Partial<FormatterSettings>): string {
    return formatSqlResult(input, options).sql;
}
