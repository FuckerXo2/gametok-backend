const fs = require('fs');
let code = fs.readFileSync('src/ai.js', 'utf8');
code = code.replace("</html>\\`;script>\\n</body>\\n</html>`;", "</html>\\`;");
fs.writeFileSync('src/ai.js', code);
