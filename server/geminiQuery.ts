import { GoogleGenAI, Type } from '@google/genai';
import type { DayType, ParsedPlainQuery, StopIndexEntry } from '../src/types/transit.ts';
import { searchStops } from './journeyPlanner.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function parsePlainLanguageJourneyQuery(
  query: string,
  stopsIndex: StopIndexEntry[]
): Promise<ParsedPlainQuery> {
  const ai = getGeminiClient();
  const stopNamesList = stopsIndex.map((s) => `${s.name} (${s.aliases.join(', ')})`).join('; ');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Parse this Delhi bus commute request into structured parameters: "${query}"`,
    config: {
      systemInstruction: `You extract journey planning fields for a Delhi bus planner app called Bheed.
Known Delhi bus hubs/stops include: ${stopNamesList}.
Rules:
- Map colloquial abbreviations like "CP" -> "Connaught Place", "ISBT" -> "Kashmere Gate ISBT" or "Anand Vihar ISBT" as stated, "SKK" -> "Sarai Kale Khan", "NDLS" -> "Paharganj / New Delhi Rly Stn".
- If time is ambiguous like "at 6" in an evening commute context or without AM/PM, default to "18:00" unless "morning"/"am" is indicated; return 24-hour "HH:MM" format clamped between "05:00" and "23:00".
- dayType must be "weekday" or "weekend" (default "weekday" if not specified).
- comfortPreference is a number from 0 to 1:
  - 0.0 to 0.2 if user prioritizes speed ("fastest", "quickest", "asap")
  - 0.5 if balanced / unspecified
  - 0.85 to 1.0 if user wants a seat or less crowding ("want a seat", "less crowded", "comfortable", "avoid rush")`,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          originQuery: { type: Type.STRING, description: 'Extracted origin place or bus stop name' },
          destinationQuery: { type: Type.STRING, description: 'Extracted destination place or bus stop name' },
          time: { type: Type.STRING, description: 'Departure time in 24-hour HH:MM format' },
          dayType: { type: Type.STRING, description: 'Either weekday or weekend' },
          comfortPreference: { type: Type.NUMBER, description: 'Comfort priority between 0 and 1' },
        },
        required: ['originQuery', 'destinationQuery', 'time', 'dayType', 'comfortPreference'],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty response while parsing the query.');
  }

  const parsed = JSON.parse(rawText) as {
    originQuery: string;
    destinationQuery: string;
    time: string;
    dayType: string;
    comfortPreference: number;
  };

  const dayType: DayType = parsed.dayType === 'weekend' ? 'weekend' : 'weekday';
  const comfort = Math.max(0, Math.min(1, Number(parsed.comfortPreference ?? 0.5)));
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(parsed.time ?? '');
  const hour = timeMatch ? Math.max(5, Math.min(23, Number(timeMatch[1]))) : 18;
  const minute = timeMatch ? Math.max(0, Math.min(59, Number(timeMatch[2]))) : 0;
  const normalizedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  const originMatches = searchStops(stopsIndex, parsed.originQuery);
  const destMatches = searchStops(stopsIndex, parsed.destinationQuery);

  const originStop = originMatches[0] ?? null;
  const destinationStop = destMatches[0] ?? null;

  const comfortLabel =
    comfort >= 0.75 ? 'Prefer seats' : comfort <= 0.25 ? 'Fastest route' : 'Balanced';

  const understandingSummary = `${originStop ? originStop.name : parsed.originQuery} → ${
    destinationStop ? destinationStop.name : parsed.destinationQuery
  } · ${normalizedTime} · ${dayType === 'weekend' ? 'Weekend' : 'Weekday'} · ${comfortLabel}`;

  return {
    originQuery: parsed.originQuery,
    destinationQuery: parsed.destinationQuery,
    time: normalizedTime,
    dayType,
    comfort,
    originStop,
    destinationStop,
    understandingSummary,
  };
}
