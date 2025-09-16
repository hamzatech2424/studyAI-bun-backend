function cleanText(text: string) {
    return text
        .replace(/\s+/g, " ")   // collapse tabs/newlines/multiple spaces into 1 space
        .replace(/\u0000/g, "") // remove null characters (sometimes PDFs have them)
        .trim();
}

function chunkText(text: string, chunkSize = 1000, overlap = 200) {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
        const slice = text.slice(i, i + chunkSize);
        chunks.push(slice);
        i += chunkSize - overlap;
    }
    return chunks;
}


export { cleanText, chunkText };