import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finny",
    short_name: "Finny",
    description: "Personal finance dashboard",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F5F7",
    theme_color: "#4f46e5",
    orientation: "portrait",
    icons: [
      { src: "/icon", sizes: "32x32",   type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
