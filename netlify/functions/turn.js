exports.handler = async () => {
  const apiKey = process.env.METERED_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const res = await fetch(
      `https://sign-paper.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
    );
    const servers = await res.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      },
      body: JSON.stringify(servers)
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Failed to fetch' }) };
  }
};
