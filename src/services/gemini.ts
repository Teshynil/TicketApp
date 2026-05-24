import { GoogleGenerativeAI } from "@google/generative-ai";
import type { TicketData } from "../types";

/**
 * Analyzes a ticket image using Google's Gemini AI.
 */
export const analyzeTicket = async (
  apiKey: string, 
  imageBase64: string, 
  modelName: string = "gemini-flash-latest",
  knownCategories: string[] = [],
  knownStores: string[] = [],
  customInstructions: string = "",
  aliases: [string, string][] = []
): Promise<TicketData> => {
  console.log(`Analyzing ticket with ${modelName}...`);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

  const aliasPrompt = aliases.length > 0 
    ? `IMPORTANT: Use these COMMERCIAL NAMES (Aliases) if you detect the corresponding LEGAL NAME:
       ${aliases.map(([legal, alias]) => `- ${legal} -> ${alias}`).join('\n')}`
    : '';

  const prompt = `
    Analyze this ticket image and extract the following information in JSON format:
    - storeName: Name of the store or restaurant. KNOWN STORES: ${knownStores.join(', ')}
      ${aliasPrompt}
    - purchaseDate: ISO DateTime format (YYYY-MM-DDTHH:mm:ss). Mexican format is usually DD/MM/YYYY.
    - amount: Total amount paid (number).
    - paymentMethod: One of [Efectivo, Tarjeta, Transferencia, Otros].
    - paymentDetail: Last 4 digits (*0648) for Tarjeta, Bank and last 4 for Transferencia, or empty for Efectivo.
    - category: A short category. EXISTING CATEGORIES: ${knownCategories.join(', ')}
    - description: A brief summary if items exist, otherwise empty.
    - items: List of objects with { name: string, quantity: number, unitPrice: number, totalPrice: number }.

    ADDITIONAL USER INSTRUCTIONS:
    ${customInstructions}

    Return ONLY raw JSON.
  `;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        data: base64Data,
        mimeType: "image/webp"
      }
    }
  ]);

  const response = await result.response;
  const text = response.text();
  
  // Robust JSON extraction
  try {
    let jsonText = "";
    
    // 1. Try to find the last markdown JSON block (models often put the final answer last)
    const jsonBlocks = text.match(/```json\s*([\s\S]*?)\s*```/g);
    if (jsonBlocks && jsonBlocks.length > 0) {
      const lastBlock = jsonBlocks[jsonBlocks.length - 1];
      jsonText = lastBlock.replace(/```json\s*|```/g, "").trim();
    } else {
      // 2. Try to find any markdown code block
      const codeBlocks = text.match(/```([\s\S]*?)\s*```/g);
      if (codeBlocks && codeBlocks.length > 0) {
        const lastBlock = codeBlocks[codeBlocks.length - 1];
        jsonText = lastBlock.replace(/```\w*\s*|```/g, "").trim();
      } else {
        // 3. Fallback: find the first { and last } that looks like an object
        const firstBrace = text.lastIndexOf('{'); // Try searching from the end first
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          // This is tricky because firstBrace might be in the middle of text
          // Let's try to find the start by going backwards from the last brace
          let balance = 0;
          let startPos = -1;
          for (let i = lastBrace; i >= 0; i--) {
            if (text[i] === '}') balance++;
            if (text[i] === '{') balance--;
            if (balance === 0) {
              startPos = i;
              break;
            }
          }
          if (startPos !== -1) {
            jsonText = text.substring(startPos, lastBrace + 1);
          }
        }
      }
    }

    if (jsonText) {
      // Clean potential trailing commas or common AI artifacts
      const cleaned = jsonText.replace(/,\s*([\}\]])/g, '$1');
      return JSON.parse(cleaned) as TicketData;
    }
    
    throw new Error('No JSON found in response');
  } catch (error) {
    console.error('Failed to parse Gemini response:', text);
    throw new Error('Failed to analyze ticket: Invalid response format');
  }
};
