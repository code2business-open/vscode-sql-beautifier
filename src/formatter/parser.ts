import { aliasExclusions, isIdentifier, keywords, modifiers, statementStarts } from './rules';
import { isExecutableComment, SqlFormatError, Token } from './tokenizer';

export interface Group {
    kind: 'group';
    open: Token;
    nodes: Node[];
    close: Token;
}

export type Node = Token | Group;

export interface Statement {
    nodes: Node[];
    end?: Token;
    customDelimiter: boolean;
}

export type ScriptPart = Statement | Token;

export const label = (node?: Node): string =>
    node?.kind === 'word' ? node.text.toUpperCase() : node?.kind === 'group' ? '(' : node?.text ?? '';
export const code = (nodes: Node[]): Node[] => nodes.filter(node => node.kind !== 'comment');

function groupTokens(tokens: Token[]): Node[] {
    const root: Node[] = [];
    const stack: { open: Token; nodes: Node[] }[] = [];
    let current = root;
    for (const token of tokens) {
        if (token.kind === 'symbol' && token.text === '(') {
            if (stack.length >= 256) throw new SqlFormatError('SQL nesting exceeds 256 levels.');
            stack.push({ open: token, nodes: [] });
            current = stack[stack.length - 1].nodes;
        } else if (token.kind === 'symbol' && token.text === ')') {
            const opening = stack.pop();
            if (!opening) throw new SqlFormatError('Unmatched closing parenthesis.');
            current = stack[stack.length - 1]?.nodes ?? root;
            current.push({ kind: 'group', ...opening, close: token });
        } else {
            if (stack.length && (token.kind === 'directive' || token.kind === 'delimiter')) {
                throw new SqlFormatError('Unclosed parenthesis before the statement terminator.');
            }
            current.push(token);
        }
    }
    if (stack.length) throw new SqlFormatError('Unclosed parenthesis.');
    return root;
}

const routineTypes = new Set(['PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT']);
const otherCreateTypes = new Set(['TABLE', 'VIEW', 'DATABASE', 'SCHEMA', 'INDEX', 'USER', 'ROLE', 'SERVER', 'TABLESPACE']);
const endTypes = new Set(['IF', 'CASE', 'LOOP', 'REPEAT', 'WHILE']);

export function routineBody(nodes: Node[]): number {
    const start = nodes.findIndex(node => node.kind !== 'comment');
    if (label(nodes[start]) !== 'CREATE') return -1;
    for (let i = start + 1; i < nodes.length; i++) {
        const word = label(nodes[i]);
        if (otherCreateTypes.has(word)) return -1;
        if (routineTypes.has(word)) return nodes.findIndex((node, index) => index > i && label(node) === 'BEGIN');
    }
    return -1;
}

export function parse(tokens: Token[]): ScriptPart[] {
    const nodes = groupTokens(tokens);
    const parts: ScriptPart[] = [];
    let pending: Node[] = [];
    let customDelimiter = false;
    let blocks = 0;
    let cases = 0;
    let seenRoutine = false;
    let previous: Node | undefined;
    function flush(end?: Token): void {
        if (pending.length || end) parts.push({ nodes: pending, end, customDelimiter });
        pending = [];
        previous = undefined;
        seenRoutine = false;
        cases = 0;
    }
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const name = label(node);
        if (node.kind === 'directive') {
            if (code(pending).length) throw new SqlFormatError('DELIMITER must follow a complete statement.');
            flush();
            const delimiter = node.text.slice(9).trim();
            customDelimiter = delimiter !== ';';
            parts.push(node);
            continue;
        }
        if (node.kind === 'delimiter') {
            if (blocks && !customDelimiter) pending.push({ ...node, kind: 'symbol' });
            else {
                if (blocks) throw new SqlFormatError('Unclosed routine block.');
                flush(node);
            }
            previous = node;
            continue;
        }
        pending.push(node);
        if (node.kind === 'comment') continue;
        if (name === 'BEGIN' && (seenRoutine || routineBody(pending) >= 0)) {
            seenRoutine = true;
            blocks++;
        } else if (blocks && name === 'CASE' && label(previous) !== 'END') {
            cases++;
        } else if (blocks && name === 'END') {
            let j = i + 1;
            while (nodes[j]?.kind === 'comment') j++;
            const following = label(nodes[j]);
            if (following === 'CASE' && cases) cases--;
            else if (!endTypes.has(following)) {
                if (cases) cases--;
                else blocks--;
            }
        }
        previous = node;
    }
    if (blocks) throw new SqlFormatError('Unclosed routine block.');
    if (customDelimiter && code(pending).length) throw new SqlFormatError('Missing custom statement terminator.');
    flush();
    return parts;
}

function validAlias(node: Node): boolean {
    if (node.kind === 'quoted') return true;
    if (node.kind === 'string') return /^['"]/.test(node.text);
    return node.kind === 'word' && !keywords.has(label(node)) && !aliasExclusions.has(label(node));
}

// Only insert AS after an expression whose end can be established from its syntax.
export function implicitAlias(nodes: Node[]): Node | undefined {
    if (nodes.some(node => node.kind !== 'group' && isExecutableComment(node))) return;
    const items = code(nodes);
    const alias = items.pop();
    if (!alias || !validAlias(alias) || !items.length) return;
    if (items.length >= 4 && label(items[0]) === 'CASE' && label(items.at(-1)) === 'END') return alias;

    let i = 0;
    const binary = new Set(['+', '-', '*', '/', '%', 'DIV', 'MOD', '&', '|', '^', '<<', '>>', '->', '->>']);
    while (i < items.length) {
        if (['+', '-', '~', '!'].includes(label(items[i]))) i++;
        const atom = items[i++];
        if (!atom) return;
        if (atom.kind === 'word' && items[i]?.kind === 'group' && !['IN', 'EXISTS', 'INTERVAL'].includes(label(atom))) {
            i++;
        } else if (isIdentifier(atom.kind) && (!keywords.has(label(atom)) || ['NULL', 'TRUE', 'FALSE', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_USER'].includes(label(atom)))
            && !aliasExclusions.has(label(atom))) {
            while (label(items[i]) === '.' && items[i + 1] && isIdentifier(items[i + 1].kind)) i += 2;
            if (items[i]?.kind === 'group') i++;
        } else if (!['string', 'number', 'parameter', 'group'].includes(atom.kind)) {
            return;
        }
        const window = items[i + 1];
        if (label(items[i]) === 'OVER' && window && (window.kind === 'group' || isIdentifier(window.kind))) i += 2;
        if (i === items.length) {
            if (alias.kind === 'string' && (items.at(-1)?.kind === 'string'
                || atom.kind === 'word' && /^(?:[bnx]|_[a-z][\w]*)$/i.test(atom.text) && items.at(-1) === atom)) return;
            return alias;
        }
        if (!binary.has(label(items[i++])) || i === items.length) return;
    }
}

export function assertStatement(nodes: Node[]): void {
    const items = code(nodes);
    if (!items.length) return;
    if (!statementStarts.has(label(items[0])) && items[0].kind !== 'group') {
        throw new SqlFormatError(`Unsupported statement starting with "${label(items[0])}".`);
    }
    const final = items.at(-1)!;
    if ((items.length === 1 && !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(label(final)) && final.kind !== 'group')
        || ['SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'BY', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
            'SET', 'AS', 'AND', 'OR', 'INTO', 'UNION', 'VALUES', 'BETWEEN', ','].includes(label(final))
        || (final.kind === 'operator' && final.text !== '*')) {
        throw new SqlFormatError('Incomplete SQL statement.');
    }
}
