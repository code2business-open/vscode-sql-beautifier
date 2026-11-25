delimiter $$
create procedure sp(in wanted int) begin
declare next_id int default 0;
if wanted is not null then select id from jobs where id=wanted; else select next_id fallback; end if;
end$$
create trigger audit_job before update on jobs for each row begin
set new.updated_at=now();
insert into audit_log(job_id,job_name) values(old.id,old.name);
end$$
delimiter ;
create function increment_id(n int) returns int deterministic begin return n+1; end;
call sp(1);
