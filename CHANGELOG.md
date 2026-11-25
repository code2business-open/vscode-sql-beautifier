# Changelog

## 0.1.1

- Separate consecutive statements with one blank line.
- Format queries beneath dashed headers by converting the divider into a MySQL comment.
- Format highlighted statements and whole clauses through VS Code's Format Selection and the dedicated SQL Beautifier command.

## 0.1.0

- Add SQL document and selection formatting for MySQL 8+ and common MariaDB syntax.
- Add configurable query layout, inline and multiline windows, and stored routine formatting.
- Preserve literals, placeholders, quoted identifiers, optimizer hints, and executable comments.
- Include an exact reference fixture, SQL snapshots, and token preservation tests.
