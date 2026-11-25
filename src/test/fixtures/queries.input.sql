select distinct 1 one, a.name, now() Clock from MyTable a;
select a.id,b.tag,c.y from a left outer join b on a.id=b.aid and (a.kind=b.kind or b.tag is null) inner join c on c.id=b.id where a.id between 1 and 7 and (c.y>5 or c.y<2) group by a.id,b.tag,c.y having count(*)>1 order by a.id desc limit 10 offset 1;
with recursive seq(n) as (select 1 union all select n+1 from seq where n<4), totals as (select sum(n) total from seq) select * from totals;
select u.id, (select max(p.total) from p where p.user_id=u.id) max_total, sum(u.id) over (order by u.id) running, sum(u.id) over (partition by u.team order by u.id range between unbounded preceding and current row) framed from users u where exists (select 1 from entries e where e.uid=u.id);
select case when x=1 then case when y>1 then 'two' else 'one' end when x=2 then 'three' else 'other' end label from things;
