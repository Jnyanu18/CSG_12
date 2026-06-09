
'use server';

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { addDays, format } from 'date-fns';
import { WeatherDataSchema, type WeatherData } from '@/lib/types';


export const getWeatherForecast = ai.defineTool(
  {
    name: 'getWeatherForecast',
    description: 'Retrieves a mock weather forecast for a given district.',
    inputSchema: z.object({
      district: z.string().describe('The district to get the weather for.'),
      days: z.number().min(1).max(30).describe('Number of days to forecast.'),
    }),
    outputSchema: z.array(WeatherDataSchema),
  },
  async (input) => {
    console.log(`[Weather Tool] Generating mock forecast for ${input.district} for ${input.days} days.`);
    
    // In a real application, you would call a weather API here.
    // For this example, we generate synthetic weather data.
    const forecast: WeatherData[] = [];
    const baseTempMax = 30 + (Math.random() * 5); // Base max temp between 30-35°C
    const baseTempMin = 20 + (Math.random() * 5); // Base min temp between 20-25°C

    for (let i = 0; i < input.days; i++) {
      const date = addDays(new Date(), i);
      const temp_max_c = baseTempMax + (Math.random() * 4 - 2); // Fluctuate by +/- 2°C
      const temp_min_c = baseTempMin + (Math.random() * 4 - 2); // Fluctuate by +/- 2°C
      forecast.push({
        date: format(date, 'yyyy-MM-dd'),
        temp_max_c: parseFloat(temp_max_c.toFixed(1)),
        temp_min_c: parseFloat(temp_min_c.toFixed(1)),
      });
    }

    return forecast;
  }
);
