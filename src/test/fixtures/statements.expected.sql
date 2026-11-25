START TRANSACTION;

SAVEPOINT before_update;

INSERT INTO Dest(id, notes)
SELECT
    id,
    note
FROM
    Source
WHERE
    enabled = TRUE;

REPLACE INTO Dest (id, notes)
VALUES
    (1, 'x'),
    (2, 'y');

UPDATE Dest d
JOIN
    Source s ON d.id = s.id
SET
    d.notes = s.note,
    d.flag = 1
WHERE
    s.id BETWEEN 1 AND 9
    AND d.flag = 0;

DELETE
FROM
    Dest
WHERE
    id = 5
LIMIT
    1;

ROLLBACK TO SAVEPOINT before_update;

COMMIT;

CREATE TEMPORARY TABLE IF NOT EXISTS Work(
    id INT PRIMARY KEY,
    notes VARCHAR(20) NOT NULL,
    meta JSON
);

ALTER TABLE Work
    ADD COLUMN extra INT,
    DROP COLUMN notes;

CREATE VIEW V AS
SELECT
    id
FROM
    Work
UNION
SELECT
    id
FROM
    Source;

PREPARE s FROM 'select * from Work where id = ?';

EXECUTE s USING @x;

DEALLOCATE PREPARE s;
