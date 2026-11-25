import { FormatterSettings } from '../configuration/settings';

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
