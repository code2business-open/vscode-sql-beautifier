DELIMITER $$
CREATE PROCEDURE sp(
    IN wanted INT
)
BEGIN
    DECLARE next_id INT DEFAULT 0;
    IF wanted IS NOT NULL THEN
        SELECT
            id
        FROM
            jobs
        WHERE
            id = wanted;
    ELSE
        SELECT
            next_id AS fallback;
    END IF;
END$$

CREATE TRIGGER audit_job BEFORE UPDATE ON jobs FOR EACH ROW
BEGIN
    SET new.updated_at = NOW();
    INSERT INTO audit_log(job_id, job_name)
    VALUES
        (old.id, old.name);
END$$
DELIMITER ;
CREATE FUNCTION increment_id(
    n INT
) RETURNS INT DETERMINISTIC
BEGIN
    RETURN n + 1;
END;

CALL sp(1);
