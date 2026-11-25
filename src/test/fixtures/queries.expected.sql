SELECT DISTINCT
    1 AS one,
    a.name,
    NOW() AS Clock
FROM
    MyTable a;

SELECT
    a.id,
    b.tag,
    c.y
FROM
    a
LEFT OUTER JOIN
    b
        ON a.id = b.aid
        AND (
            a.kind = b.kind
            OR b.tag IS NULL
        )
INNER JOIN
    c ON c.id = b.id
WHERE
    a.id BETWEEN 1 AND 7
    AND (
        c.y > 5
        OR c.y < 2
    )
GROUP BY
    a.id,
    b.tag,
    c.y
HAVING
    COUNT(*) > 1
ORDER BY
    a.id DESC
LIMIT
    10
OFFSET
    1;

WITH RECURSIVE seq(n) AS (
    SELECT
        1
    UNION ALL
    SELECT
        n + 1
    FROM
        seq
    WHERE
        n < 4
),
totals AS (
    SELECT
        SUM(n) AS total
    FROM
        seq
)
SELECT
    *
FROM
    totals;

SELECT
    u.id,
    (
        SELECT
            MAX(p.total)
        FROM
            p
        WHERE
            p.user_id = u.id
    ) AS max_total,
    SUM(u.id) OVER (ORDER BY u.id) AS running,
    SUM(u.id) OVER (
        PARTITION BY u.team
        ORDER BY u.id
        RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS framed
FROM
    users u
WHERE
    EXISTS (
        SELECT
            1
        FROM
            entries e
        WHERE
            e.uid = u.id
    );

SELECT
    CASE
        WHEN x = 1
        THEN
            CASE
                WHEN y > 1
                THEN 'two'
                ELSE 'one'
            END
        WHEN x = 2
        THEN 'three'
        ELSE 'other'
    END AS label
FROM
    things;
