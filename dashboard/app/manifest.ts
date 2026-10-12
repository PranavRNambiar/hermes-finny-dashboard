import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finny",
    short_name: "Finny",
    description: "Personal finance dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#F0F1F5",
    theme_color: "#0E2A2F",
    orientation: "portrait",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
