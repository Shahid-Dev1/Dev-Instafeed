/**
 * Admin GraphQL product queries. Page sizes keep the calculated query cost well under Shopify's
 * 1,000-point single-query limit: 10 products x 50 variants ~ 520 points.
 */
export const PRODUCT_PAGE_SIZE = 10;
export const VARIANT_PAGE_SIZE = 50;

const VARIANT_FIELDS = `id title sku price availableForSale position selectedOptions { name value } image { url }`;
const PRODUCT_FIELDS = `
  id handle title status updatedAt
  featuredMedia { preview { image { url } } }
  variants(first: ${VARIANT_PAGE_SIZE}) { pageInfo { hasNextPage endCursor } nodes { ${VARIANT_FIELDS} } }`;

export const PRODUCTS_QUERY = `query Products($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes { ${PRODUCT_FIELDS} }
  }
}`;

export const PRODUCT_QUERY = `query Product($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`;

export const PRODUCT_VARIANTS_QUERY = `query ProductVariants($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${VARIANT_FIELDS} } }
  }
}`;

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface VariantNode {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  availableForSale: boolean;
  position: number;
  selectedOptions: { name: string; value: string }[];
  image: { url: string } | null;
}

export interface ProductNode {
  id: string;
  handle: string;
  title: string;
  status: string;
  updatedAt: string;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { pageInfo: PageInfo; nodes: VariantNode[] };
}

export interface ProductsPage {
  products: { pageInfo: PageInfo; nodes: ProductNode[] };
}

export const productGid = (numericId: string | number) => `gid://shopify/Product/${numericId}`;
