import mysql from '/root/.openclaw/workspace/api-trans/node_modules/mysql2/promise.js';
const pool = mysql.createPool({host:'127.0.0.1', port:3306, user:'root', password:'wzjself', database:'api_trans'});
const [all] = await pool.execute("SELECT COUNT(*) AS requests, COALESCE(SUM(tokens),0) AS tokens, MIN(created_at) AS min_ct, MAX(created_at) AS max_ct FROM usage_logs");
console.log('ALL=', JSON.stringify(all, null, 2));
const [days] = await pool.execute(`
  WITH RECURSIVE d AS (
    SELECT DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR), INTERVAL 13 DAY) AS day
    UNION ALL
    SELECT DATE_ADD(day, INTERVAL 1 DAY) FROM d WHERE day < DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)
  )
  SELECT DATE_FORMAT(d.day, '%Y-%m-%d') AS day, COALESCE(COUNT(u.id),0) AS requests, COALESCE(SUM(u.tokens),0) AS tokens
  FROM d
  LEFT JOIN usage_logs u ON DATE(CONVERT_TZ(u.created_at, '+00:00', '+08:00')) = d.day
  GROUP BY d.day ORDER BY d.day ASC
`);
console.log('DAYS=', JSON.stringify(days, null, 2));
const sum = days.reduce((a,r)=>({requests:a.requests+Number(r.requests||0), tokens:a.tokens+Number(r.tokens||0)}), {requests:0,tokens:0});
console.log('SUM14=', JSON.stringify(sum, null, 2));
const [days2] = await pool.execute(`
  WITH RECURSIVE days AS (
    SELECT DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR), INTERVAL 13 DAY) AS d
    UNION ALL
    SELECT DATE_ADD(d, INTERVAL 1 DAY) FROM days WHERE d < DATE(UTC_TIMESTAMP() + INTERVAL 8 HOUR)
  ),
  usage_by_day AS (
    SELECT DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) AS d, COUNT(*) AS requests, COALESCE(SUM(tokens),0) AS tokens
    FROM usage_logs
    GROUP BY DATE(CONVERT_TZ(created_at, '+00:00', '+08:00'))
  )
  SELECT DATE_FORMAT(days.d, '%Y-%m-%d') AS day, COALESCE(usage_by_day.requests,0) AS requests, COALESCE(usage_by_day.tokens,0) AS tokens
  FROM days LEFT JOIN usage_by_day ON usage_by_day.d = days.d
  ORDER BY days.d ASC
`);
console.log('DAYS_FIXED=', JSON.stringify(days2, null, 2));
const sum2 = days2.reduce((a,r)=>({requests:a.requests+Number(r.requests||0), tokens:a.tokens+Number(r.tokens||0)}), {requests:0,tokens:0});
console.log('SUM14_FIXED=', JSON.stringify(sum2, null, 2));
await pool.end();
