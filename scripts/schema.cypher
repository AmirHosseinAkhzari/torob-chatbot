// Uniqueness constraints (also back the id lookups)
CREATE CONSTRAINT shop_id IF NOT EXISTS FOR (s:Shop) REQUIRE s.shop_id IS UNIQUE;
CREATE CONSTRAINT product_id IF NOT EXISTS FOR (p:Product) REQUIRE p.product_id IS UNIQUE;
CREATE CONSTRAINT offer_id IF NOT EXISTS FOR (o:Offer) REQUIRE o.offer_id IS UNIQUE;
CREATE CONSTRAINT category_name IF NOT EXISTS FOR (c:Category) REQUIRE c.name IS UNIQUE;
CREATE CONSTRAINT brand_name IF NOT EXISTS FOR (b:Brand) REQUIRE b.name IS UNIQUE;
CREATE CONSTRAINT area_name IF NOT EXISTS FOR (a:Area) REQUIRE a.name IS UNIQUE;
CREATE CONSTRAINT payment_provider_name IF NOT EXISTS FOR (p:PaymentProvider) REQUIRE p.name IS UNIQUE;

// Range indexes for filtering / sorting
CREATE INDEX offer_price IF NOT EXISTS FOR (o:Offer) ON (o.price_toman);
CREATE INDEX product_min_price IF NOT EXISTS FOR (p:Product) ON (p.min_price_toman);
CREATE INDEX product_brand IF NOT EXISTS FOR (p:Product) ON (p.brand_name);
CREATE INDEX product_category IF NOT EXISTS FOR (p:Product) ON (p.category_name);
CREATE INDEX shop_name IF NOT EXISTS FOR (s:Shop) ON (s.name);
CREATE POINT INDEX shop_location IF NOT EXISTS FOR (s:Shop) ON (s.location);

// Full-text (Persian analyzer) for natural-language lookups by the chatbot
CREATE FULLTEXT INDEX product_text IF NOT EXISTS FOR (p:Product)
  ON EACH [p.title, p.brand_name, p.category_name, p.model, p.specs_text]
  OPTIONS {indexConfig: {`fulltext.analyzer`: 'persian'}};
// Title/model only: use this for "find product X"; spec numbers in product_text cause false hits
CREATE FULLTEXT INDEX product_title IF NOT EXISTS FOR (p:Product)
  ON EACH [p.title, p.model]
  OPTIONS {indexConfig: {`fulltext.analyzer`: 'persian'}};
CREATE FULLTEXT INDEX offer_text IF NOT EXISTS FOR (o:Offer)
  ON EACH [o.seller_title, o.description]
  OPTIONS {indexConfig: {`fulltext.analyzer`: 'persian'}};
CREATE FULLTEXT INDEX shop_text IF NOT EXISTS FOR (s:Shop)
  ON EACH [s.name, s.address, s.area]
  OPTIONS {indexConfig: {`fulltext.analyzer`: 'persian'}};
CREATE FULLTEXT INDEX lookup_text IF NOT EXISTS FOR (n:Category|Brand|Area)
  ON EACH [n.name]
  OPTIONS {indexConfig: {`fulltext.analyzer`: 'persian'}};
