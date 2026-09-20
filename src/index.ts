import pino from "pino";
import { createApp } from "./app.js";
import { httpCouch } from "./couch.js";
import { httpAgora } from "./agora.js";

const logger = pino();
const port = Number(process.env.PORT ?? 8080);

createApp(httpCouch, httpAgora).listen(port, () => {
  logger.info({ port }, "lyceum listening");
});
