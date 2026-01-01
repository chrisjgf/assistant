import { useContext } from "react"
import { ContainerContext } from "../context/ContainerContext"
import type { ContainerContextValue } from "../context/ContainerContext"

export function useContainers(): ContainerContextValue {
  const context = useContext(ContainerContext)
  if (!context) {
    throw new Error("useContainers must be used within a ContainerProvider")
  }
  return context
}
