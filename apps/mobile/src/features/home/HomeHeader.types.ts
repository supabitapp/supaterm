import type {
  HomeListFilterMenuEnvironment,
  HomeListFilterMenuInput,
} from "./home-list-filter-menu";

export type HomeHeaderEnvironment = HomeListFilterMenuEnvironment;

export interface HomeHeaderProps extends HomeListFilterMenuInput {
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onOpenEnvironments: () => void;
  readonly onOpenSettings: () => void;
}
