class APIFEATURES {
  constructor(query, queryString) {
    this.query = query;
    this.queryString = queryString;
  }

  filter() {
    const queryObj = { ...this.queryString };
    console.log(queryObj);
    const excludedFields = ["page", "sort", "limit", "fields"];
    excludedFields.forEach((el) => delete queryObj[el]);

    // Advanced filtering
    let queryStr = JSON.stringify(queryObj);

    // Handle operators like gte, gt, lte, lt
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, (match) => `$${match}`);

    // Handle comma-separated values for fields like status
    const parsedQuery = JSON.parse(queryStr);
    Object.keys(parsedQuery).forEach((key) => {
      if (
        typeof parsedQuery[key] === "string" &&
        parsedQuery[key].includes(",")
      ) {
        parsedQuery[key] = { $in: parsedQuery[key].split(",") };
      }
    });

    this.query = this.query.find(parsedQuery);
    return this;
  }

  // 3) Field Limiting
  limitFields() {
    console.log(this.queryString);
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(",").join(" ");
      this.query = this.query.select(fields);
    } else {
      this.query = this.query.select("-__v");
    }

    return this;
  }

  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(",").join(" ");
      ["price rat "];
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort({ created_at: -1 });
    }
    return this;
  }

  paginate() {
    const page = this.queryString.page * 1 || 1;
    const limit = this.queryString.limit * 1 || 10;
    const skip = (page - 1) * limit;
    this.query = this.query.skip(skip).limit(limit);

    return this;
  }
}

module.exports = APIFEATURES;
