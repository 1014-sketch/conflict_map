// api/events.js
const axios = require('axios');

// 🔍 検索クエリ: 過去2日間の紛争・軍事・危機ニュースに限定
// when:2d を指定して鮮度を保証
const QUERY = '(war OR conflict OR military OR "air strike" OR "missile attack" OR "ceasefire") when:2d';

// 📍 位置情報データベース
const LOCATION_COORDS = {
  // アジア・中東
  'Gaza': { lat: 31.3547, lng: 34.3088 },
  'Israel': { lat: 31.0461, lng: 34.8516 },
  'Lebanon': { lat: 33.8547, lng: 35.8623 },
  'Beirut': { lat: 33.8938, lng: 35.5018 },
  'Iran': { lat: 32.4279, lng: 53.6880 },
  'Tehran': { lat: 35.6892, lng: 51.3890 },
  'Yemen': { lat: 15.5527, lng: 48.5164 },
  'Red Sea': { lat: 20.0, lng: 38.0 },
  'Ukraine': { lat: 48.3794, lng: 31.1656 },
  'Kyiv': { lat: 50.4501, lng: 30.5234 },
  'Russia': { lat: 61.5240, lng: 105.3188 },
  'Moscow': { lat: 55.7558, lng: 37.6173 },
  'Taiwan': { lat: 23.6978, lng: 120.9605 },
  'China': { lat: 35.8617, lng: 104.1954 },
  'Philippines': { lat: 12.8797, lng: 121.7740 },
  'South China Sea': { lat: 12.0, lng: 113.0 },
  'Myanmar': { lat: 21.9162, lng: 95.9560 },
  'North Korea': { lat: 40.3399, lng: 127.5101 },
  'South Korea': { lat: 35.9078, lng: 127.7669 },
  'Afghanistan': { lat: 33.9391, lng: 67.7100 },
  'Pakistan': { lat: 30.3753, lng: 69.3451 },
  'India': { lat: 20.5937, lng: 78.9629 },
  'Syria': { lat: 34.8021, lng: 38.9968 },
  'Iraq': { lat: 33.2232, lng: 43.6793 },

  // アフリカ
  'Sudan': { lat: 12.8628, lng: 30.2176 },
  'Khartoum': { lat: 15.5007, lng: 32.5599 },
  'Somalia': { lat: 5.1521, lng: 46.1996 },
  'Congo': { lat: -4.0383, lng: 21.7587 },
  'Nigeria': { lat: 9.0820, lng: 8.6753 },
  'Libya': { lat: 26.3351, lng: 17.2283 },

  // その他
  'USA': { lat: 39.8283, lng: -98.5795 },
  'Washington': { lat: 38.9072, lng: -77.0369 },
  'Haiti': { lat: 18.9712, lng: -72.2852 },
  'Venezuela': { lat: 6.4238, lng: -66.5897 },
  'Mexico': { lat: 23.6345, lng: -102.5528 }
};

// RSSパース関数（強化版）
function parseRSS(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const content = match[1];
    
    // タイトル取得（CDATA対応）
    let title = '';
    const titleMatch = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/.exec(content);
    if (titleMatch) title = titleMatch[1];

    // リンク取得
    let link = '';
    const linkMatch = /<link>(.*?)<\/link>/.exec(content);
    if (linkMatch) link = linkMatch[1];

    // 日付取得
    let pubDate = new Date();
    const dateMatch = /<pubDate>(.*?)<\/pubDate>/.exec(content);
    if (dateMatch) pubDate = new Date(dateMatch[1]);

    if (title && link) {
      items.push({ title, link, pubDate });
    }
  }
  return items;
}

// 深刻度判定
function calculateSeverity(text) {
  const t = text.toLowerCase();
  if (t.includes('dead') || t.includes('kill') || t.includes('strike') || t.includes('blast') || t.includes('attack')) return 'critical';
  if (t.includes('war') || t.includes('military') || t.includes('missile') || t.includes('operation')) return 'high';
  if (t.includes('warn') || t.includes('tension') || t.includes('risk')) return 'medium';
  return 'low';
}

// カテゴリ判定
function determineCategory(text) {
  const t = text.toLowerCase();
  if (t.includes('protest') || t.includes('rally')) return 'protest';
  if (t.includes('aid') || t.includes('humanitarian')) return 'humanitarian';
  if (t.includes('talks') || t.includes('diploma') || t.includes('meet')) return 'diplomatic';
  return 'conflict';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 【重要】User-Agentを設定してブラウザからのアクセスに見せかける
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(QUERY)}&hl=en-US&gl=US&ceid=US:en`;
    
    console.log(`Requesting RSS: ${rssUrl}`);
    
    const response = await axios.get(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/xml, text/xml, */*'
      },
      timeout: 8000
    });
    
    const rawItems = parseRSS(response.data);
    const events = [];
    let eventId = 1;
    
    // 現在時刻
    const now = new Date();

    for (const item of rawItems) {
      // 3日以上前の古いニュースは除外（念のため）
      const diffDays = (now - item.pubDate) / (1000 * 60 * 60 * 24);
      if (diffDays > 3) continue;

      const content = item.title.toLowerCase();
      let matchedLocation = null;

      // 地名マッチング
      for (const [name, coords] of Object.entries(LOCATION_COORDS)) {
        if (content.includes(name.toLowerCase())) {
          matchedLocation = { name, ...coords };
          break; 
        }
      }

      if (matchedLocation) {
        events.push({
          id: eventId++,
          title: item.title,
          location: matchedLocation.name,
          lat: matchedLocation.lat,
          lng: matchedLocation.lng,
          severity: calculateSeverity(item.title),
          description: "Click to see full coverage.",
          date: item.pubDate,
          category: determineCategory(item.title),
          sources: 1,
          articleUrl: item.link
        });
      }
    }

    // 重複削除
    const uniqueEvents = [];
    const seen = new Set();
    events.forEach(ev => {
        const key = ev.location + ev.title.substring(0, 15);
        if (!seen.has(key)) {
            seen.add(key);
            uniqueEvents.push(ev);
        }
    });

    res.json({
      success: true,
      count: uniqueEvents.length,
      events: uniqueEvents,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error("RSS Error:", error.message);
    // エラー時は空配列を返し、フロントエンドに「データ取得不可」を表示させる（嘘のデータは出さない）
    res.status(500).json({
        success: false,
        error: error.message,
        events: [] 
    });
  }
};