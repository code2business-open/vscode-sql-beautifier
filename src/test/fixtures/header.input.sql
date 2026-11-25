-- CREDITS TO RELEASE QUERY
----------------------------------------------------------------------------------------------------
WITH credits_to_release AS (
SELECT
customer,
SUM(`value`) AS amount
FROM
cash
WHERE
type = 'c'
AND `deadline` BETWEEN '2026-11-30' AND '2026-11-30 23:59:59'
GROUP BY
customer
)
SELECT
c.id AS ID,
c.name AS NOME,
c.user AS LOGIN,
s.amount AS VALOR,
SUM(s.amount) OVER (
ORDER BY c.id
ROWS UNBOUNDED PRECEDING
) AS TOTAL
FROM
credits_to_release s
LEFT JOIN
customer c ON c.id = s.customer
ORDER BY
c.id;
