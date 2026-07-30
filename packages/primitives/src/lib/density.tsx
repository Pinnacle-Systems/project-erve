import { createContext, type ReactNode, useContext } from "react";
import { useTheme, type Density } from "@erve/theme";

const DensityOverrideContext = createContext<Density | undefined>(undefined);

export function useResolvedDensity(explicitDensity?: Density): Density {
  const inheritedDensity = useContext(DensityOverrideContext);
  const { densityName } = useTheme();

  return explicitDensity ?? inheritedDensity ?? densityName;
}

export function DensityOverrideProvider({
  density,
  children,
}: {
  density: Density;
  children: ReactNode;
}) {
  return (
    <DensityOverrideContext.Provider value={density}>
      {children}
    </DensityOverrideContext.Provider>
  );
}
