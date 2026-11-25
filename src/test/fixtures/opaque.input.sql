-- Header
select /*+ MAX_EXECUTION_TIME(1000) */ `weird``Name`, :param, ?, @`user name`, N'a''z', X'00FE', _utf8mb4'Olá', 'a\'b', "two  spaces", payload->>'$.x' extracted
from `CaseSensitive`.Items /* table note */
where id=? and id<>@x; -- Statement note
/*!80000 SET @n=1 */;
/*M!100100 SET @other=2 */;
# Tail
