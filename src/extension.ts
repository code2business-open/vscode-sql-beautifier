import * as vscode from 'vscode';
import { defaults, FormatterSettings } from './configuration/settings';
import { formatSqlSelection } from './formatter/formatter';

const command = 'sqlBeautifier.formatSql';
const selectionCommand = 'sqlBeautifier.formatSelection';

function settingsFor(document: vscode.TextDocument): FormatterSettings {
    const configuration = vscode.workspace.getConfiguration('sqlBeautifier', document);
    const settings = { ...defaults };
    function read<K extends keyof FormatterSettings>(key: K): void {
        settings[key] = configuration.get(key, defaults[key]);
    }
    (Object.keys(defaults) as (keyof FormatterSettings)[]).forEach(read);
    return settings;
}

function rangeFor(document: vscode.TextDocument): vscode.Range {
    return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

function formatRanges(document: vscode.TextDocument, ranges: vscode.Range[]): { edits: vscode.TextEdit[]; error?: string } {
    const source = document.getText();
    const settings = settingsFor(document);
    const edits: vscode.TextEdit[] = [];
    for (const range of ranges) {
        const start = document.offsetAt(range.start);
        const end = document.offsetAt(range.end);
        const result = formatSqlSelection(source, start, end, settings);
        if (result.error) return { edits: [], error: result.error };
        if (result.sql !== source.slice(start, end)) edits.push(vscode.TextEdit.replace(range, result.sql));
    }
    return { edits };
}

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel('SQL Beautifier Pro');
    const selector: vscode.DocumentSelector = { language: 'sql' };

    function getEdits(document: vscode.TextDocument, ranges: vscode.Range[]): vscode.TextEdit[] {
        const result = formatRanges(document, ranges);
        if (result.error) output.appendLine(result.error);
        return result.edits;
    }

    async function formatEditor(selectionOnly: boolean): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'sql') return;
        const selections = editor.selections.filter(selection => !selection.isEmpty);
        if (selectionOnly && !selections.length) return;
        const ranges = selections.length ? selections : [rangeFor(editor.document)];
        const { edits, error } = formatRanges(editor.document, ranges);
        if (error) {
            output.appendLine(error);
            void vscode.window.showWarningMessage(`SQL Beautifier: ${error}`);
            return;
        }
        if (edits.length) {
            const applied = await editor.edit(builder => edits.forEach(edit => builder.replace(edit.range, edit.newText)));
            if (!applied) void vscode.window.showWarningMessage('SQL Beautifier: The editor could not apply the formatting edits.');
        }
    }

    context.subscriptions.push(
        output,
        vscode.languages.registerDocumentFormattingEditProvider(selector, {
            provideDocumentFormattingEdits(document, _options, token) {
                return token.isCancellationRequested ? [] : getEdits(document, [rangeFor(document)]);
            },
        }),
        vscode.languages.registerDocumentRangeFormattingEditProvider(selector, {
            provideDocumentRangeFormattingEdits(document, range, _options, token) {
                return token.isCancellationRequested ? [] : getEdits(document, [range]);
            },
            provideDocumentRangesFormattingEdits(document, ranges, _options, token) {
                return token.isCancellationRequested ? [] : getEdits(document, ranges);
            },
        }),
        vscode.commands.registerCommand(command, () => formatEditor(false)),
        vscode.commands.registerCommand(selectionCommand, () => formatEditor(true)),
    );
}
