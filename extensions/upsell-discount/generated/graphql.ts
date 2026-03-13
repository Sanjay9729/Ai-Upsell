export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  Decimal: { input: any; output: any; }
};

export type Attribute = {
  __typename?: 'Attribute';
  key?: Maybe<Scalars['String']['output']>;
  value?: Maybe<Scalars['String']['output']>;
};

export type Cart = {
  __typename?: 'Cart';
  attribute?: Maybe<Attribute>;
  lines: Array<CartLine>;
};


export type CartAttributeArgs = {
  key: Scalars['String']['input'];
};

export type CartLine = {
  __typename?: 'CartLine';
  attribute?: Maybe<Attribute>;
  cost?: Maybe<CartLineCost>;
  id: Scalars['ID']['output'];
  merchandise?: Maybe<Merchandise>;
  quantity: Scalars['Int']['output'];
};


export type CartLineAttributeArgs = {
  key: Scalars['String']['input'];
};

export type CartLineCost = {
  __typename?: 'CartLineCost';
  amountPerQuantity: Money;
};

export type Merchandise = {
  id: Scalars['ID']['output'];
};

export type Money = {
  __typename?: 'Money';
  amount: Scalars['Decimal']['output'];
  currencyCode: Scalars['String']['output'];
};

export type Product = {
  __typename?: 'Product';
  id: Scalars['ID']['output'];
};

export type ProductVariant = Merchandise & {
  __typename?: 'ProductVariant';
  id: Scalars['ID']['output'];
  product: Product;
};

export type Query = {
  __typename?: 'Query';
  cart?: Maybe<Cart>;
};

export type InputQueryVariables = Exact<{ [key: string]: never; }>;


export type InputQuery = { __typename?: 'Query', cart?: { __typename?: 'Cart', attribute?: { __typename?: 'Attribute', key?: string | null, value?: string | null } | null, lines: Array<{ __typename?: 'CartLine', id: string, quantity: number, attribute?: { __typename?: 'Attribute', key?: string | null, value?: string | null } | null, cost?: { __typename?: 'CartLineCost', amountPerQuantity: { __typename?: 'Money', amount: any, currencyCode: string } } | null, merchandise?: { __typename: 'ProductVariant', id: string, product: { __typename?: 'Product', id: string } } | null }> } | null };
