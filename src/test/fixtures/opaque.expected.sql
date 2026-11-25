-- Header
SELECT /*+ MAX_EXECUTION_TIME(1000) */
    `weird``Name`,
    :param,
    ?,
    @`user name`,
    N'a''z',
    X'00FE',
    _utf8mb4'Olá',
    'a\'b',
    "two  spaces",
    payload ->> '$.x' AS extracted
FROM
    `CaseSensitive`.Items /* table note */
WHERE
    id = ?
    AND id <> @x; -- Statement note

/*!80000 SET @n=1 */;

/*M!100100 SET @other=2 */;
# Tail
