import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("markets/:id", "routes/market.tsx"),
  route("me", "routes/me.tsx"),
  route("leaderboard", "routes/leaderboard.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
] satisfies RouteConfig;
