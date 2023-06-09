const https = require("https");
const axios = require("axios");
const levenshtein = require("js-levenshtein");
const {
  GraphQLObjectType,
  GraphQLID,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLSchema,
  GraphQLList,
  GraphQLNonNull,
  GraphQLEnumType,
  GraphQLScalarType,
  GraphQLBoolean,
} = require("graphql");

const User = require("../models/userModel");
const toTitleCase = require("../utils/titleCase");
const { errorName } = require("../utils/constant");

// let bankData = null;

// const options = {
//   method: "GET",
//   url: "https://api.paystack.co/bank?country=nigeria",
//   headers: {
//     Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
//   },
// };

// axios(options)
//   .then((response) => {
//     bankData = response.data;
//   })
//   .catch((error) => {
//     console.error("BANK DATA ERROR: ", error);
//   });

// setTimeout(() => {
//   console.log(bankData);
// }, 2000);

// user type
const UserType = new GraphQLObjectType({
  name: "User",
  fields: () => ({
    id: { type: GraphQLID },
    user_account_number: { type: GraphQLString },
    user_bank_code: { type: GraphQLString },
    user_account_name: { type: GraphQLString },
    is_verified: { type: GraphQLBoolean, defaultValue: false },
  }),
});

// query
const RootQuery = new GraphQLObjectType({
  name: "RootQueryType",
  fields: {
    users: {
      type: new GraphQLList(UserType),
      resolve(parent, args) {
        return User.findAll();
      },
    },

    user: {
      type: UserType,
      args: {
        user_account_number: { type: GraphQLString },
        user_bank_code: { type: GraphQLString },
      },
      resolve(parent, args) {
        const { user_account_number, user_bank_code } = args;

        // Check that the user account number is exactly 10 digits
        if (user_account_number.toString().length !== 10) {
          throw new Error(errorName.ACCOUNT_NUMBER_LENGTH_ERROR);
        }

        return User.findOne({
          where: {
            user_account_number,
            user_bank_code,
          },
        }).then((user) => {
          if (!user) {
            throw new Error(errorName.USER_DOESNT_EXIST);
          }

          if (user.user_account_name) {
            // User has provided their own account name
            return {
              ...user.dataValues,
              user_account_name: toTitleCase(user.user_account_name),
            };
          } else {
            // Call Paystack API to resolve account name
            const options = {
              method: "GET",
              url: "https://api.paystack.co/bank/resolve",
              params: {
                account_number: user.user_account_number,
                bank_code: user.user_bank_code,
              },
              headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              },
            };

            return axios(options)
              .then((response) => {
                const resolvedAccountName = toTitleCase(
                  response.data.data.account_name
                );
                return {
                  ...user.dataValues,
                  user_account_name: resolvedAccountName,
                };
              })
              .catch((error) => {
                console.error(error);
                return null;
              });
          }
        });
      },
    },
  },
});

const mutation = new GraphQLObjectType({
  name: "Mutation",
  fields: {
    addUser: {
      type: UserType,
      args: {
        user_account_number: { type: GraphQLString },
        user_bank_code: { type: GraphQLString },
        user_account_name: { type: GraphQLString },
        is_verified: { type: GraphQLBoolean, defaultValue: false },
      },
      resolve(parent, args) {
        const {
          user_account_number,
          user_bank_code,
          user_account_name,
          is_verified,
        } = args;

        // Check that the user account number is exactly 10 digits
        if (user_account_number.toString().length !== 10) {
          throw new Error(errorName.ACCOUNT_NUMBER_LENGTH_ERROR);
        }

        return User.findOne({
          where: {
            user_account_number,
          },
        }).then((existingUser) => {
          if (existingUser) {
            throw new Error(errorName.USER_ALREADY_EXISTS);
          }

          const options = {
            method: "GET",
            url: "https://api.paystack.co/bank/resolve",
            params: {
              account_number: user_account_number,
              bank_code: user_bank_code,
            },
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
          };

          return axios(options)
            .then((response) => {
              const resolvedAccountName = response.data.data.account_name;
              const userAccountName = user_account_name.toLowerCase();
              const resolvedAccountNameLower =
                resolvedAccountName.toLowerCase();
              const ld = levenshtein(userAccountName, resolvedAccountNameLower);

              if (ld <= 2) {
                return User.create({
                  user_account_number,
                  user_bank_code,
                  user_account_name,
                  is_verified: true,
                }).then((user) => {
                  return { ...user.dataValues, id: user.id };
                });
              } else {
                return User.create({
                  user_account_number,
                  user_bank_code,
                  user_account_name,
                  is_verified,
                }).then((user) => {
                  return { ...user.dataValues, id: user.id };
                });
              }
            })
            .catch((error) => {
              console.error(error);
              console.log();
              if (
                error.response &&
                error.response.status === 422 &&
                error.response.data.status === false
              ) {
                throw new Error(errorName.INVALID_BANK_DETAILS);
              } else {
                throw new Error(errorName.SERVER_ERROR);
              }
            });
        });
      },
    },
  },
});

module.exports = new GraphQLSchema({
  query: RootQuery,
  mutation,
});
