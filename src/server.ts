import { app } from "./app";
import { config } from "./config";

app.listen(config.port, () => {
  console.log(`API rodando em http://localhost:${config.port}`);
});
