import { FormatterSettings } from '../configuration/settings';

interface Span { start: number; end: number }
interface GapEdit extends Span { text: string }

export function lineBreakCount(text: string): number {
    return text.match(/\r\n|\r|\n/g)?.length ?? 0;
}

export function retainBlankLines(source: string, tokens: Span[], output: Map<number, Span>, sql: string,
    lineStarts: number[], eol: string, documentEdges: boolean): { sql: string; lineStarts: number[] } {
    const edits: GapEdit[] = [];
    let sourceEnd = tokens[0].start;
    let blankLines = documentEdges ? lineBreakCount(source.slice(0, sourceEnd)) : 0;
    let previous: Span | undefined;
    let line = 0;
    for (const token of tokens) {
        blankLines += Math.max(0, lineBreakCount(source.slice(sourceEnd, token.start)) - 1);
        sourceEnd = token.end;
        const next = output.get(token.start);
        if (!next) continue;
        if (blankLines && previous) {
            const breaks = lineBreakCount(sql.slice(previous.end, next.start));
            const missing = blankLines + 1 - breaks;
            if (missing > 0) {
                if (breaks) {
                    edits.push({ start: previous.end, end: previous.end, text: eol.repeat(missing) });
                } else {
                    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= next.start) line++;
                    const indent = /^[ \t]*/.exec(sql.slice(lineStarts[line], next.start))![0];
                    edits.push({ start: previous.end, end: next.start, text: eol.repeat(missing) + indent });
                }
            }
        } else if (blankLines && documentEdges) {
            edits.push({ start: 0, end: 0, text: eol.repeat(blankLines) });
        }
        previous = next;
        blankLines = 0;
    }
    if (documentEdges) {
        const trailing = lineBreakCount(source.slice(sourceEnd));
        const existing = lineBreakCount(sql.slice(previous?.end ?? 0));
        const wanted = previous ? trailing + blankLines + (blankLines && !trailing ? 1 : 0)
            : Math.max(0, trailing - 1) + blankLines;
        if (wanted > existing) edits.push({ start: sql.length, end: sql.length, text: eol.repeat(wanted - existing) });
    }
    if (!edits.length) return { sql, lineStarts };

    let cursor = 0;
    let lineIndex = 0;
    let result = '';
    const starts: number[] = [];
    for (const edit of edits) {
        while (lineIndex < lineStarts.length && lineStarts[lineIndex] < edit.start) {
            starts.push(result.length + lineStarts[lineIndex++] - cursor);
        }
        result += sql.slice(cursor, edit.start);
        for (const match of edit.text.matchAll(/\r\n|\r|\n/g)) starts.push(result.length + match.index + match[0].length);
        result += edit.text;
        cursor = edit.end;
    }
    while (lineIndex < lineStarts.length) {
        const start = result.length + lineStarts[lineIndex++] - cursor;
        if (starts.at(-1) !== start) starts.push(start);
    }
    return { sql: result + sql.slice(cursor), lineStarts: starts };
}

export class Writer {
    private readonly lines: string[] = [];
    private line = '';
    private readonly indent: string;

    constructor(private readonly settings: FormatterSettings, private readonly eol: string) {
        this.indent = settings.useTabs ? '\t' : ' '.repeat(settings.indentSize);
    }

    get hasText(): boolean { return this.line.length > 0; }
    get width(): number {
        return this.line.replace(/\t/g, ' '.repeat(this.settings.indentSize)).length;
    }

    write(text: string, level: number, space = false): void {
        if (!this.hasText) this.line = this.indent.repeat(level);
        else if (space) this.line += ' ';
        this.line += text;
    }

    newline(): void {
        if (this.hasText) this.lines.push(this.line);
        this.line = '';
    }

    blankLine(): void {
        this.newline();
        if (this.lines.length && this.lines.at(-1) !== '') this.lines.push('');
    }

    finish(): string {
        this.newline();
        return this.lines.join(this.eol);
    }

    lineStarts(): number[] {
        let offset = 0;
        return this.lines.map(line => {
            const start = offset;
            offset += line.length + this.eol.length;
            return start;
        });
    }
}
