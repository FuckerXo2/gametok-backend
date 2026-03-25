const fs = require('fs');
let code = fs.readFileSync('src/ai.js', 'utf8');

// Replace all \` with `
code = code.split('\\`').join('`');

// Restore the end of the html template if we just ruined what used to be a proper \\` in the template literal, actually template literals inside the string might need to be escaped but we don't have any inner template literals!
fs.writeFileSync('src/ai.js', code);
console.log('Fixed syntax!');
