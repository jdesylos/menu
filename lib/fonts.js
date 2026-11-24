import localFont from "next/font/local";

// Fonte compartilhada em módulo único para evitar instâncias duplicadas de
// `next/font/local` entre páginas e componentes.
export const instrumentSans = localFont({
  src: [
    { path: "../assets/InstrumentSans-Regular.woff2", weight: "400" },
    { path: "../assets/InstrumentSans-SemiBold.woff2", weight: "600" },
  ],
  display: "swap",
});
