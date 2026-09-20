import pino from "pino";
import { createApp } from "./app.js";
import { httpCouch } from "./couch.js";

const logger = pino();
const port = Number(process.env.PORT ?? 8080);

createApp(httpCouch).listen(port, () => {
  logger.info({ port }, "lyceum listening");
});
