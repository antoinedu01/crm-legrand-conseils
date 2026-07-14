import app from './app.js';

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CRM Legrand Conseils — API démarrée sur http://localhost:${PORT}`);
});
