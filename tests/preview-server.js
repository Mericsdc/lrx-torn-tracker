// Isolated fixture server for browser QA; never reads the installed user's data.
if (!process.env.TORN_DATA_DIR || !process.send) throw new Error('Run through ui-smoke.js');
const { server } = require('../server');
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
