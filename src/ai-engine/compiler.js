export function compileGameHTML(json, assetMap) {
    // Under the new Omni-Engine architecture inspired by Rezona, the AI 
    // now generates a COMPLETE HTML5 document that includes the Canvas,
    // style tags, DOM UI, and the game script inline.
    
    let htmlCode = typeof json === 'object' ? json.code : json;

    // Optional: We can inject a small error listener just for debugging 
    // before the closing </head> tag, to ensure the webview catches errors.
    const errorListener = `
    <script>
        window.onerror = function(msg, source, lineno, colno, error) {
            console.error("Game Error: " + msg + " at line " + lineno);
            return true;
        };
    </script>
    `;

    // Inject the error listener into the head if possible 
    // (the AI will generate the <head> tag)
    if (htmlCode && htmlCode.includes('</head>')) {
        htmlCode = htmlCode.replace('</head>', `${errorListener}\n</head>`);
    }

    return htmlCode;
}

