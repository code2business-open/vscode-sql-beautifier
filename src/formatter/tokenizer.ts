export type TokenKind = 'word' | 'quoted' | 'string' | 'number' | 'parameter'
    | 'symbol' | 'operator' | 'comment' | 'directive' | 'delimiter';

export interface Token {
    kind: TokenKind;
    text: string;
    start: number;
    end: number;
    lineBreakBefore: boolean;
    bareDivider?: true;
}

export class SqlFormatError extends Error {}

const wordStart = /[a-z_$\u0080-\uFFFF]/i;
const wordPart = /[a-z0-9_$\u0080-\uFFFF]/i;
const operators = ['<=>', '->>', '!=', '<>', '<=', '>=', ':=', '||', '&&', '<<', '>>', '->', '=', '<', '>', '+', '-', '/', '%', '&', '|', '^', '~', '!', '*'];
const numeric = /(?:0x[\da-f]+|0b[01]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/iy;

export const isLineComment = (token: Token): boolean =>
    token.kind === 'comment' && !token.text.startsWith('/*');
export const isProtectedComment = (token: Token): boolean =>
    token.kind === 'comment' && /^\/\*(?:[!+]|M!)/i.test(token.text);
export const isExecutableComment = (token: Token): boolean =>
    token.kind === 'comment' && /^\/\*(?:!|M!)/i.test(token.text);

export function tokenize(sql: string): Token[] {
    const tokens: Token[] = [];
    let delimiter = ';';
    let i = 0;
    let lineHead = true;
    let lineBreakBefore = false;

    function quoted(at: number): number {
        const quote = sql[at];
        for (let j = at + 1; j < sql.length; j++) {
            if (sql[j] === '\\' && quote !== '`') {
                j++;
            } else if (sql[j] === quote) {
                if (sql[j + 1] !== quote) return j + 1;
                j++;
            }
        }
        throw new SqlFormatError('Unterminated quoted identifier or string.');
    }

    function take(kind: TokenKind, end: number): void {
        tokens.push({ kind, text: sql.slice(i, end), start: i, end, lineBreakBefore });
        i = end;
        lineBreakBefore = false;
        lineHead = false;
    }

    while (i < sql.length) {
        const c = sql[i];
        if (/\s/.test(c)) {
            if (c === '\n' || c === '\r') {
                lineHead = true;
                lineBreakBefore = true;
            }
            i++;
            continue;
        }
        if (lineHead && /^delimiter[ \t]/i.test(sql.slice(i, i + 10))) {
            let end = i;
            while (end < sql.length && sql[end] !== '\n' && sql[end] !== '\r') end++;
            const value = sql.slice(i + 9, end).trim();
            if (!value || /[\s\\'"`]/.test(value)) throw new SqlFormatError('Unsupported DELIMITER directive.');
            delimiter = value;
            take('directive', end);
        } else if (sql.startsWith(delimiter, i)) {
            take('delimiter', i + delimiter.length);
        } else if (c === '#' || (sql.startsWith('--', i) && /[\x00-\x20\x7F]/.test(sql[i + 2] ?? ' '))) {
            let end = i + 1;
            while (end < sql.length && sql[end] !== '\n' && sql[end] !== '\r') end++;
            take('comment', end);
        } else if (sql.startsWith('/*', i)) {
            const end = sql.indexOf('*/', i + 2);
            if (end < 0) throw new SqlFormatError('Unterminated block comment.');
            take('comment', end + 2);
        } else if (c === "'" || c === '"' || c === '`') {
            take(c === '`' ? 'quoted' : 'string', quoted(i));
        } else if (c === '@') {
            let end = i + (sql[i + 1] === '@' ? 2 : 1);
            if (["'", '"', '`'].includes(sql[end])) {
                end = quoted(end);
            } else {
                while (end < sql.length && /[\w.$\u0080-\uFFFF]/.test(sql[end]) && !sql.startsWith(delimiter, end)) end++;
            }
            if (end === i + 1) throw new SqlFormatError('Incomplete variable.');
            take('parameter', end);
        } else if (c === '?' || (c === ':' && wordStart.test(sql[i + 1] ?? ''))) {
            let end = i + 1;
            if (c === ':') {
                while (end < sql.length && wordPart.test(sql[end]) && !sql.startsWith(delimiter, end)) end++;
            }
            take('parameter', end);
        } else {
            numeric.lastIndex = i;
            const number = numeric.exec(sql);
            if (number && !wordPart.test(sql[numeric.lastIndex] ?? '')) {
                take('number', numeric.lastIndex);
            } else if (wordPart.test(c)) {
                let end = i + 1;
                while (end < sql.length && wordPart.test(sql[end]) && !sql.startsWith(delimiter, end)) end++;
                const word = sql.slice(i, end);
                if ((/^(?:[bnx]|_[a-z][\w]*)$/i.test(word)) && ["'", '"'].includes(sql[end])) {
                    take('string', quoted(end));
                } else {
                    take('word', end);
                }
            } else if ('(),.;:{}'.includes(c)) {
                take('symbol', i + 1);
            } else {
                const operator = operators.find(value => sql.startsWith(value, i));
                if (!operator) throw new SqlFormatError(`Unsupported SQL character ${JSON.stringify(c)}.`);
                take('operator', i + operator.length);
            }
        }
    }
    return tokens;
}
