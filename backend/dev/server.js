/**
 * Local backend for development: runs the real src/*.gs code on the in-memory
 * Apps Script services from tests/gas-mocks.js, seeded with three weeks of
 * realistic (fictional) lab data.
 *
 *   node dev/server.js            → http://localhost:8787/exec
 *
 * Point the admin portal (APPS_SCRIPT_URL / ADMIN_SECRET) or the kiosk
 * (Settings → http://localhost:8787/exec) at it. Data lives in memory only.
 */
const http = require('http');
const { createEnvironment } = require('../tests/gas-mocks');

const PORT = Number(process.env.PORT || 8787);
const SECRETS = { KIOSK_SECRET: 'dev-kiosk-secret', PIPELINE_SECRET: 'dev-pipeline-secret', ADMIN_SECRET: 'dev-admin-secret' };

const FIRST = ['Aarav', 'Diya', 'Vihaan', 'Ananya', 'Arjun', 'Ishita', 'Kabir', 'Meera', 'Rohan', 'Saanvi',
  'Aditya', 'Kavya', 'Reyansh', 'Myra', 'Krish', 'Aanya', 'Dhruv', 'Riya', 'Yash', 'Tara',
  'Nikhil', 'Pooja', 'Siddharth', 'Sneha', 'Harsh', 'Nisha', 'Parth', 'Zoya', 'Om', 'Khushi',
  'Dev', 'Janvi', 'Manan', 'Prisha', 'Rudra', 'Hetvi', 'Jay', 'Krupa', 'Neel', 'Vidhi'];
const LAST = ['Patel', 'Shah', 'Mehta', 'Desai', 'Joshi', 'Trivedi', 'Parmar', 'Chauhan', 'Rao', 'Iyer'];
const BATCHES = ['SCC/5-7', 'SCC/3-5', 'SCC/Weekend'];
const ACTIVITIES = [
  'Built the onboarding flow for my SwiftUI app', 'Worked through the Swift concurrency tutorial',
  'Fixed layout bugs on iPad', 'Prepared slides for the club demo day', 'Learned Core Data basics',
  'Pair-programmed a widget with WidgetKit', 'Debugged a crash in the Xcode simulator',
  'Designed app icons in Figma', 'Wrote unit tests with XCTest', 'Explored visionOS sample code'
];

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

function seed(env) {
  const random = rng(7);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const gs = env.gs;

  env.props = { ...SECRETS, MASTER_SHEET_ID: 'master', ATTENDANCE_SHEET_ID: 'aatce', FACE_DATASET_FOLDER_ID: 'faces', EMBEDDINGS_FOLDER_ID: 'emb' };
  env.addFolder('faces', 'Face-Dataset');
  env.addFolder('emb', 'Embeddings');

  const students = FIRST.map((first, i) => ({
    enrollment_no: String(2203051050100 + i),
    name: `${first} ${LAST[i % LAST.length]}`,
    email: `${first.toLowerCase()}.${LAST[i % LAST.length].toLowerCase()}@students.example.edu`,
    batch: i % 7 === 0 ? `${BATCHES[i % 3]}, ${BATCHES[(i + 1) % 3]}` : BATCHES[i % 3]
  }));
  env.spreadsheets.master = {
    Master_Students: [['enrollment_no', 'name', 'email', 'batch_tags'],
      ...students.map(s => [s.enrollment_no, s.name, s.email, s.batch])]
  };
  env.spreadsheets.aatce = {};
  Object.keys(gs.HEADERS).forEach((tab) => { env.spreadsheets.aatce[tab] = [[...gs.HEADERS[tab]]]; });

  const call = (action, params) => env.post({ secret: SECRETS.KIOSK_SECRET, action, ...params });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0xff, 0xd9]).toString('base64');
  students.slice(0, 32).forEach((s) => {
    call('enroll', { enrollment_no: s.enrollment_no, consent: true });
    call('upload_faces', { enrollment_no: s.enrollment_no, images: [jpeg, jpeg, jpeg, jpeg, jpeg] });
  });
  [['W2601', 'Neha Kulkarni', 'neha.k@example.com'], ['W2602', 'Rahul Verma', 'rahul.v@example.com']].forEach(([id, name, email]) => {
    call('enroll', { enrollment_no: id, consent: true, name, email });
  });

  const now = new Date();
  const ist = (daysAgo, minutes) => {
    const d = new Date(now.getTime() + 330 * 60000);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() - 330 * 60000 - daysAgo * 86400000 + minutes * 60000;
  };

  const visits = [];
  for (let day = 20; day >= 0; day--) {
    const weekday = new Date(ist(day, 12 * 60)).getUTCDay();
    const busy = weekday === 0 ? 4 : weekday === 6 ? 9 : 14;
    const count = Math.round(busy * (0.6 + random() * 0.6));
    for (let k = 0; k < count; k++) {
      const s = pick(students);
      const peak = random() < 0.6 ? 17 * 60 : 10 * 60;
      const start = peak + Math.round((random() - 0.3) * 180);
      const length = 25 + Math.round(random() * 150);
      visits.push({ s, entry: ist(day, start), exit: ist(day, start + length), today: day === 0 });
    }
  }
  visits.sort((a, b) => a.entry - b.entry);

  const scans = [];
  visits.forEach((v) => {
    scans.push({ t: v.entry, s: v.s });
    if (!v.today || v.exit < now.getTime()) scans.push({ t: v.exit, s: v.s, exit: true });
  });
  scans.sort((a, b) => a.t - b.t).forEach(({ t, s }) => {
    if (t > now.getTime()) return;
    env.clock = t;
    call('scan', { enrollment_no: s.enrollment_no, method: random() < 0.06 ? 'manual' : 'face' });
  });
  env.clock = now.getTime() - 3 * 86400000;
  call('scan', { enrollment_no: 'W2601', workshop_name: 'Intro to SwiftUI' });
  call('scan', { enrollment_no: 'W2602', workshop_name: 'Intro to SwiftUI' });

  // A few people checked in right now, whatever the time of day, so occupancy is never empty in dev.
  [95, 40, 12].forEach((minutesAgo, i) => {
    env.clock = now.getTime() - minutesAgo * 60000;
    call('scan', { enrollment_no: students[36 + i].enrollment_no });
  });

  env.clock = now.getTime();
  env.tab = (name) => env.spreadsheets.aatce[name];
  env.tab('Attendance_Log').slice(1).forEach((row) => {
    if (row[3] && row[4] >= 15 && random() < 0.7) {
      gs.submitActivity(row[0], pick(ACTIVITIES));
    }
  });
  gs.closeStaleSessions();
  env.sentMail.length = 0;
}

const env = createEnvironment();
seed(env);

http.createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  };
  if (!req.url.startsWith('/exec')) return send(404, '{"error":"not found"}');
  if (req.method !== 'POST') {
    return send(200, JSON.stringify({ success: false, error: 'GET is not supported', error_code: 'method_not_allowed' }));
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    env.clock = Date.now();
    send(200, env.gs.doPost({ postData: { contents: body } }).content);
  });
}).listen(PORT, () => {
  const log = env.spreadsheets.aatce.Attendance_Log.length - 1;
  console.log(`AATCE dev backend on http://localhost:${PORT}/exec (${log} sessions seeded)`);
  console.log('Secrets: ' + Object.entries(SECRETS).map(([k, v]) => `${k}=${v}`).join('  '));
});
