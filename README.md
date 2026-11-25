# SQL Beautifier Pro

A local SQL formatter for VS Code, designed for MySQL 8+ with a MariaDB mode. Queries use indented clause contents, one SELECT expression per line, and explicit `AS` for unambiguous column aliases. The formatter handles multi-statement scripts, joins, CTEs, subqueries, window functions, transactions, DDL, and stored programs with MySQL client `DELIMITER` directives.

## Install and use

Install the VSIX from **Extensions → … → Install from VSIX…**, or run:

```sh
code --install-extension builds/sql-beautifier-pro.vsix
```

Open a `.sql` file and use **Format Document** or the standard VS Code shortcut (Shift+Option+F on macOS, Shift+Alt+F on Windows, Ctrl+Shift+I on Linux). Highlight complete statements or whole clauses such as `WHERE` and `ORDER BY` and run **Format Selection**. The standard shortcut is Command+K Command+F on macOS or Ctrl+K Ctrl+F on Windows and Linux. **SQL Beautifier: Format Selection** is also available in the Command Palette and editor context menu when text is highlighted. Both commands leave the text outside the highlight untouched, including any unselected semicolon. **SQL Beautifier: Format SQL** formats the selection when present and the document otherwise.

Consecutive top-level statements are separated by one blank line. A header line made entirely of dashes receives the space required to make it a valid MySQL line comment.

To select this extension as the default SQL formatter and enable format on save:

```json
{
	"[sql]": {
		"editor.defaultFormatter": "sql-beautifier-pro.sql-beautifier-pro",
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
