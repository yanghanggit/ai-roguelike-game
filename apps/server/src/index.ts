import { app } from "./app.js";
import { PORTS } from "@roguelike/shared";

app.listen(PORTS.server, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORTS.server}`);
});
