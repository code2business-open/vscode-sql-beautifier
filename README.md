# SQL Beautifier Pro

A local SQL formatter for VS Code, designed for MySQL 8+ with a MariaDB mode. Queries use indented clause contents, one SELECT expression per line, and explicit `AS` for unambiguous column aliases. The formatter handles multi-statement scripts, joins, CTEs, subqueries, window functions, transactions, DDL, and stored programs with MySQL client `DELIMITER` directives.

## Install and use

Install the VSIX from **Extensions → … → Install from VSIX…**, or run:

```sh
code --install-extension builds/sql-beautifier-pro.vsix
```

In a SQL editor, the standard formatting shortcut formats the highlight if there is one and the whole file otherwise. Use Shift+Option+F on macOS, Shift+Alt+F on Windows, or Ctrl+Shift+I on Linux. Highlight complete statements or whole clauses such as `WHERE` and `ORDER BY`. Selections that cut through a token or clause are rejected without edits.

**SQL Beautifier: Format SQL** follows the same behavior. You can also use **Format Selection** (Command+K Command+F on macOS or Ctrl+K Ctrl+F on Windows and Linux) or **SQL Beautifier: Format Selection** from the Command Palette or editor context menu. **Format Document** and **Format on Save** always apply to the whole file.

Consecutive top-level statements have at least one blank line between them. Existing blank lines are preserved by default. Standalone dashed dividers before or between statements become valid MySQL line comments.

Put `-- sql-beautifier-ignore` on its own line immediately before a top-level statement to keep the directive and statement as written during whole-file formatting. To skip formatting a whole file, use `-- sql-beautifier-ignore-file` as the first nonblank line. To override either directive, highlight a complete statement or whole clause and format the selection. Select All also works with selection-formatting commands. Both directives stay in place for Format Document and whole-file Format on Save.

To select this extension as the default SQL formatter and enable format on save:

```json
{
	"[sql]": {
		"editor.defaultFormatter": "code2business.sql-beautifier-pro",
		"editor.formatOnSave": true
	}
}
```

## Settings

All settings use the `sqlBeautifier.` prefix and can be overridden for SQL files in VS Code.

| Setting                      | Default    | Effect                                                                                                                                   |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `dialect`                    | `mysql`    | Use `mariadb` for MariaDB `RETURNING` on INSERT, REPLACE, and DELETE.                                                                    |
| `indentSize`                 | `4`        | Spaces per indent and display width used for tabs.                                                                                       |
| `useTabs`                    | `false`    | Indent with tabs.                                                                                                                        |
| `keywordCase`                | `upper`    | `upper`, `lower`, or `preserve`.                                                                                                         |
| `functionCase`               | `upper`    | Case of recognized built-ins. Qualified function names retain their spelling.                                                            |
| `identifierCase`             | `preserve` | Explicitly recase unquoted identifiers with `upper` or `lower`. Keep `preserve` when spelling or case-sensitive name resolution matters. |
| `explicitColumnAliases`      | `true`     | Insert `AS` after safely recognized SELECT expressions.                                                                                  |
| `commaPosition`              | `trailing` | Use `leading` to start continued list lines with commas.                                                                                 |
| `clauseContentOnNewLine`     | `true`     | Place clause contents on indented lines.                                                                                                 |
| `oneColumnPerLine`           | `true`     | Place each SELECT expression on its own line.                                                                                            |
| `joinTableOnNewLine`         | `true`     | Place joined tables on an indented line.                                                                                                 |
| `breakBeforeLogicalOperator` | `true`     | Start continued conditions with `AND` or `OR`. Set to `false` to put operators at the ends of lines.                                     |
| `maxLineLength`              | `120`      | Preferred width for list, JOIN, and window wrapping. Long literals, comments, and indivisible expressions can exceed this width.         |
| `preserveComments`           | `true`     | Keep ordinary comments. Optimizer hints and executable comments are always retained.                                                     |
| `preserveBlankLines`         | `true`     | Keep existing blank lines within and between statements and at the start and end of the document.                                       |
| `trailingSemicolon`          | `preserve` | Use `always` or `never` for the final statement’s semicolon. Earlier terminators and custom delimiters are retained.                     |

Use whole-document formatting on scripts with custom delimiters. The engine assumes standard MySQL string escaping and preserves scripts that reference `SQL_MODE`. It keeps the spelling of unnamed expressions when MySQL derives an externally visible column name from their text, such as in a derived table. It checks token boundaries and structural consistency locally. Detected incomplete or unsupported input is returned unchanged. The palette command reports the reason in a warning, and the standard formatting providers log to the **SQL Beautifier Pro** Output channel. Server-side syntax validation still belongs to MySQL or MariaDB.

## Build, test, and package

Use Node.js 20 or newer and VS Code 1.85 or newer. Run these commands from the repository root:

```sh
npm ci
npm test
npm run package
code --install-extension artifacts/sql-beautifier-pro.vsix
```

Open the repository in VS Code and press F5 to launch the Extension Development Host. The launch configuration builds TypeScript before opening the new window. Open a SQL file there to try the formatting commands.

The standalone engine exports `formatSql(input, settings?)` and `formatSqlResult(input, settings?)` from `dist/formatter/formatter.js`. The latter returns the SQL and an optional diagnostic. `formatSqlSelection(input, start, end, settings?)` returns replacement text for the selected offsets and an optional diagnostic. The tokenizer preserves source lexemes and recognizes MySQL client delimiters. The structural parser groups statements and parentheses, and the renderer applies layout rules. The formatter checks the result against the original tokens and verifies idempotency before returning an edit. It executes locally without a database connection or runtime dependencies.

SQL Formatter supports MySQL and MariaDB, but its documented layout options do not specify the distinct SELECT, JOIN, and window layouts required here. Node SQL Parser provides AST parsing and SQL generation, and its documented round trip can add identifier quoting. The extension uses a custom token-aware renderer to match the reference layout and retain source lexemes. [SQL Formatter options](https://github.com/sql-formatter-org/sql-formatter#configuration-options) · [Node SQL Parser round-trip example](https://github.com/taozhi8833998/node-sql-parser#convert-ast-back-to-sql) · [VS Code packaging documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
