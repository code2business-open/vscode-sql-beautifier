# Changelog

## 0.1.5

- Let explicit SQL selections override ignore comments while keeping both directives in place for whole-file formatting.

## 0.1.4

- Preserve existing blank lines by default and allow disabling it with `sqlBeautifier.preserveBlankLines`.
- Support ignore comments for one statement or an entire file.
- Update the documented VS Code default formatter ID.
- Make the standard formatting shortcut format only highlighted SQL when a selection is active.

## 0.1.3

- Format SQL scripts with dashed section dividers between statements.

## 0.1.2

- Add an icon for SQL Beautifier Pro in the VS Code Extensions view.

## 0.1.1

- Separate consecutive statements with one blank line.
- Format queries beneath dashed headers by converting the divider into a MySQL comment.
- Format highlighted statements and whole clauses through VS Code's Format Selection and the dedicated SQL Beautifier command.

## 0.1.0

- Add SQL document and selection formatting for MySQL 8+ and common MariaDB syntax.
- Add configurable query layout, inline and multiline windows, and stored routine formatting.
- Preserve literals, placeholders, quoted identifiers, optimizer hints, and executable comments.
- Include an exact reference fixture, SQL snapshots, and token preservation tests.
