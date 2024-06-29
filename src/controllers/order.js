import Order from "../models/Order.js";
import ProductDetail from "../models/ProductDetail.js";
import Cart from "../models/Cart.js";
import { orderValid } from "../validation/order.js";
import Review from "../models/Review.js";
import mongoose from "mongoose";
// Hàm sinh chuỗi ngẫu nhiên
function generateRandomCode(length) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export const createOrder = async (req, res) => {
  try {
    const body = req.body;

    // Validate dữ liệu order
    const { error } = orderValid.validate(body, { abortEarly: false });
    if (error) {
      const errors = error.details.map((err) => err.message);
      return res.status(400).json({
        message: errors,
      });
    }

    // Kiểm tra và sinh codeOrders nếu phương thức thanh toán là "cod"
    if (body.paymentMethod === "cod") {
      body.codeOrders = generateRandomCode(8);
      body.paymentStatus = "unpaid";
      body.orderStatus = "pending"; // Đơn hàng bắt đầu ở trạng thái pending
    } else if (body.paymentMethod === "vnpay") {
      body.paymentStatus = "paid";
      body.orderStatus = "pending"; // Đơn hàng được hoàn tất ngay lập tức
    }

    const newOrder = new Order(body);

    // Tính tổng giá tiền và kiểm tra số lượng sản phẩm
    let totalPrice = 0;
    for (const product of newOrder.productDetails) {
      const { productDetailId, promotionalPrice, quantityOrders } = product;

      // Kiểm tra sản phẩm có tồn tại không
      const productExist = await ProductDetail.findById(productDetailId);
      if (!productExist) {
        return res.status(404).json({
          message: "Không tìm thấy ProductDetail",
        });
      }

      // Kiểm tra số lượng sản phẩm có đủ không
      if (productExist.quantity < quantityOrders) {
        return res.status(400).json({
          message: `Sản phẩm với ID ${productDetailId} không đủ số lượng`,
        });
      }

      totalPrice += promotionalPrice * quantityOrders;

      // Trừ số lượng sản phẩm
      productExist.quantity -= quantityOrders;
      await productExist.save();
    }
    newOrder.total_price = totalPrice;

    // Lưu đơn hàng vào cơ sở dữ liệu
    const order = await newOrder.save();

    // Xóa các mục trong giỏ hàng liên quan đến đơn hàng vừa được tạo thành công
    const productDetailIds = newOrder.productDetails.map(
      (product) => product.productDetailId
    );
    await Cart.deleteMany({
      user: order.user_id,
      productDetail: { $in: productDetailIds },
    });

    return res.status(200).json({
      message: "Tạo đơn hàng thành công",
      data: order,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};



// Các chức năng khác giữ nguyên
// export const getAllOrders = async (req, res) => {
//   try {
//     const { user } = req;
//     const { status } = req.query;

//     let filter = {};

//     if (user.role !== "admin") {
//       filter.user_id = user._id;
//     }

//     if (status) {
//       filter.orderStatus = status;
//     }

//     // Fetch orders based on filter criteria
//     const orders = await Order.find(filter)
//       .populate("user_id", "userName email")
//       .sort({ createdAt: -1 });

//     // Iterate through each order
//     const ordersWithReviews = await Promise.all(
//       orders.map(async (order) => {
//         // Iterate through each productDetail in the order
//         const productDetailsWithReviews = await Promise.all(
//           order.productDetails.map(async (productDetail) => {
//             // Fetch reviews for the current productId
//             const reviews = await Review.find({
//               productId: productDetail.productId,
//               idAccount: user._id, // Assuming you want reviews by the logged-in user
//             });

//             // Check if the user has reviewed this product
//             const isRated = reviews.length > 0;

//             // Add isRated field to productDetail
//             return {
//               ...productDetail.toObject(),
//               isRated: isRated,
//             };
//           })
//         );

//         // Return the order with updated productDetails including isRated
//         return {
//           ...order.toObject(),
//           productDetails: productDetailsWithReviews,
//         };
//       })
//     );

//     return res.status(200).json({
//       message: "Fetch All Orders Successful",
//       data: ordersWithReviews,
//     });
//   } catch (error) {
//     return res.status(500).json({
//       message: error.message,
//     });
//   }
// };

export const getAllOrders = async (req, res) => {
  try {
    const { user } = req;
    const { status } = req.query;

    let filter = {};

    if (user.role !== "admin") {
      filter.user_id = user._id;
    }

    if (status) {
      filter.orderStatus = status;
    }

    // Fetch orders based on filter criteria
    const orders = await Order.find(filter)
      .populate("user_id", "userName email")
      .sort({ createdAt: -1 });

    // Iterate through each order
    const ordersWithReviews = await Promise.all(
      orders.map(async (order) => {
        // Fetch reviews for all productDetails in the order
        const productDetailIds = order.productDetails.map((pd) => pd.productId);

        const reviews = await Review.find({
          idAccount: user._id,
          productId: { $in: productDetailIds },
        });

        // Create a map to store isRated status for each productId
        const isRatedMap = {};
        reviews.forEach((review) => {
          isRatedMap[review.productId.toString()] = true;
        });

        // Add isRated field to order
        const isRatedOrder = order.productDetails.some((pd) =>
          isRatedMap.hasOwnProperty(pd.productId.toString())
        );

        const orderWithIsRated = {
          ...order.toObject(),
          isRated: isRatedOrder,
        };

        return orderWithIsRated;
      })
    );

    return res.status(200).json({
      message: "Fetch All Orders Successful",
      data: ordersWithReviews,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getOrderDetail = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { user } = req;

    const order = await Order.findById(orderId).populate(
      "user_id",
      "userName email fullName"
    );

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    // Kiểm tra quyền của người dùng
    if (
      user.role !== "admin" &&
      order.user_id._id.toString() !== user._id.toString()
    ) {
      return res.status(403).json({
        message: "Bạn không có quyền truy cập chi tiết đơn hàng này",
      });
    }

    // Fetch reviews for all productDetails in the order
    const productDetailIds = order.productDetails.map((pd) => pd.productId);

    const reviews = await Review.find({
      idAccount: user._id,
      productId: { $in: productDetailIds },
    });

    // Create a map to store isRated status for each productId
    const isRatedMap = {};
    reviews.forEach((review) => {
      isRatedMap[review.productId.toString()] = true;
    });

    // Add isRated field to order
    const isRatedOrder = order.productDetails.some((pd) =>
      isRatedMap.hasOwnProperty(pd.productId.toString())
    );

    const orderWithIsRated = {
      ...order.toObject(),
      isRated: isRatedOrder,
    };

    return res.status(200).json({
      message: "Fetch Order Detail Successful",
      data: orderWithIsRated,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const updateOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { orderStatus } = req.body;
    const { user } = req; // Lấy thông tin người dùng từ req.user

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    // Define valid transitions
    const validTransitions = {
      pending: ["waiting", "cancel"], // Chỉ admin có thể chuyển từ pending sang waiting hoặc cancel
      waiting: ["delivering", "cancel"], // Chỉ admin có thể chuyển từ waiting sang delivering hoặc cancel
      delivering: ["done"], // Chỉ admin có thể chuyển từ delivering sang done
      done: [],
      cancel: [],
    };

    // Kiểm tra quyền của user và điều chỉnh validTransitions
    if (user.role === "user" && order.orderStatus !== "pending") {
      return res.status(403).json({
        message: "Bạn không có quyền thay đổi trạng thái đơn hàng này",
      });
    }

    // Kiểm tra trạng thái hợp lệ
    if (!validTransitions[order.orderStatus].includes(orderStatus)) {
      return res.status(400).json({
        message: `Invalid status transition from ${order.orderStatus} to ${orderStatus}`,
      });
    }

    // Nếu trạng thái chuyển thành "done", giảm số lượng của từng sản phẩm trong đơn hàng
    if (orderStatus === "done") {
      for (const product of order.productDetails) {
        const { productDetailId, quantityOrders } = product;
        const productDetailRecord = await ProductDetail.findById(
          productDetailId
        );
        if (productDetailRecord) {
          productDetailRecord.quantity -= quantityOrders;
          await productDetailRecord.save();
        } else {
          return res.status(404).json({
            message: `ProductDetail with ID ${productDetailId} not found`,
          });
        }
      }

      if (order.paymentMethod === "cod") {
        order.paymentStatus = "paid"; // Cập nhật paymentStatus khi orderStatus chuyển thành "done"
      }
    }

    order.orderStatus = orderStatus;
    order.statusHistory.push({
      adminId: user._id,
      status: orderStatus,
    });
    await order.save();

    return res.status(200).json({
      message: "Update Order Successful",
      data: order,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};

// export const getHistoryStatusOrder = async (req, res) => {
//   try {
//     const { orderId } = req.params;

//     const order = await Order.findById(orderId)
//       .populate("statusHistory.adminId", "fullName")
//       .populate("user_id", "fullName"); // assuming 'fullName' is the field you want to display for user

//     if (!order) {
//       return res.status(404).json({
//         message: "Order not found",
//       });
//     }

//     const statusHistory = order.statusHistory.map((history) => ({
//       adminId: history.adminId._id,
//       adminName: history.adminId.fullName,
//       status: history.status,
//       timestamp: history.timestamp,
//       userFullName: order.user_id.fullName, // Adding user's full name to each statusHistory item
//     }));

//     return res.status(200).json({
//       message: "Status history retrieved successfully",
//       orderId: order._id,
//       statusHistory: statusHistory,
//     });
//   } catch (error) {
//     return res.status(500).json({
//       message: error.message,
//     });
//   }
// };

export const getHistoryStatusOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .populate("statusHistory.adminId", "fullName")
      .populate("user_id", "fullName"); // assuming 'fullName' is the field you want to display for user

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
      });
    }

    const statusHistory = order.statusHistory.map((history) => ({
      adminId: history.adminId?._id,
      adminName: history.adminId?.fullName || "Unknown", // Default to "Unknown" if adminId or fullName is missing
      status: history.status,
      timestamp: history.timestamp,
      
    }));

    return res.status(200).json({
      message: "Status history retrieved successfully",
      orderId: order._id,
      statusHistory: statusHistory,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};
