// Isolated fixture server for browser QA; never reads the installed user's data.
if (!process.env.TORN_DATA_DIR || !process.send) throw new Error('Run through ui-smoke.js');
// A fixture without an explicit local service must never contact the public API.
process.env.TORN_PREMIUM_SERVICE_URL ??= '';
const { server } = require('../server');
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
