const fs = require('fs');
let code = fs.readFileSync('src/ai.js', 'utf8');

// The file has '\\`' everywhere instead of '`', let's replace '\\`' with '`' where it belongs to previewHtml.
code = code.replace(/const previewHtml = \\`<!DOCTYPE html>/, "const previewHtml = `<!DOCTYPE html>");
code = code.replace("</html>\\\\`;", "</html>`;");
code = code.replace("</html>\\`;", "</html>`;");

// The `includes` statement
code = code.replace(/cleanCode\.includes\\('\\\\\\`\\\\\\`\\\\\\`'\\)/g, "cleanCode.includes('```')");
code = code.replace(/cleanCode\.replace\\(\/\\\\\\`\\\\\\`\\\\\\`.*\\/g, "cleanCode.replace(/```/");

// Wait, let's just do a clean global replacement of '\`' to '`' if it's only in those spots. No, let's target accurately.
code = code.replace("const previewHtml = \\`<!DOCTYPE html>", "const previewHtml = `<!DOCTYPE html>");
code = code.replace("</html>\\`;", "</html>`;");

fs.writeFileSync('src/ai.js', code);
console.log('Fixed syntax!');
