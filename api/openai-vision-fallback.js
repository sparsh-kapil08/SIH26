const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function tryOpenAiVision({ images, promptText }) {
    if (!OPENAI_API_KEY) return null;

    const content = [
        { type: 'text', text: promptText },
        ...images.map(image => ({
            type: 'image_url',
            image_url: { url: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}` }
        }))
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [{ role: 'user', content }],
            temperature: 0.1,
            response_format: { type: 'json_object' },
            max_tokens: 2048
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI Vision HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const rawText = result.choices?.[0]?.message?.content;
    if (!rawText) throw new Error('OpenAI Vision returned no text');

    return {
        success: true,
        data: JSON.parse(rawText),
        modelUsed: OPENAI_MODEL,
        provider: 'openai',
        rawResponse: result
    };
}

module.exports = { tryOpenAiVision, openAiConfigured: Boolean(OPENAI_API_KEY) };
