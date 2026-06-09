# **App Name**: AgriVisionAI

## Core Features:

- Tomato Detection: Detect and count tomatoes in uploaded images using YOLOv8 or fallback to color/contour analysis.
- Growth Stage Classification: Classify the growth stage of tomatoes (immature, ripening, mature) using rule-based HSV/LAB analysis. The system can also implement an optional ResNet-18 model if available, improving classification accuracy and acting as a tool for fine-grained maturity assessment.
- Yield Estimation and Forecast: Estimate current yield and forecast future yield based on GDD and user-defined parameters, providing insights into expected tomato production.
- Harvest Scheduling: Generate a harvest schedule that respects harvesting capacity and readiness windows, optimizing the harvesting process.
- Market Price Forecasting: Forecast market prices using ARIMA (with Prophet as an option) to determine the best date to sell tomatoes for maximum profit.
- Interactive Dashboard: Display detection results, forecasts, and market analysis in an intuitive Streamlit dashboard with multiple tabs and controls.
- In-App Chat Assistant: Provide an in-app chat assistant that answers user queries related to yield, forecast, and market prices based on the data available in the app's state. The assistant has an intent parser for on-page state, providing relevant and deterministic replies.

## Style Guidelines:

- Primary color: Earthy orange (#D2691E) evoking warmth and the natural tones of ripe tomatoes.
- Background color: Light beige (#F5F5DC), a desaturated tone similar to the primary, for a clean and bright presentation.
- Accent color: A muted teal (#66CDAA) providing a gentle contrast to the orange, and harmonizing with concepts of nature and growth.
- Body text font: 'Inter' (sans-serif) for a modern and readable UI. Headline font: 'Space Grotesk' (sans-serif) for headlines to convey a techy, contemporary feel.
- Use clear, consistent icons related to farming, weather, and markets.
- A clean, organized layout with a sidebar for controls and multiple tabs for different functionalities.
- Subtle animations for loading data and transitions between tabs.