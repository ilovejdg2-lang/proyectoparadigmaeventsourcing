const fs = require('fs');

fs.cpSync('history/src/public', 'dist-history/public', { recursive: true });
